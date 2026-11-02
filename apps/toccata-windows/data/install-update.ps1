# Fixed Windows portable updater. Input is a private JSON request, never shell text.
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding $false
[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false
function Save-Result($path,$value){[IO.File]::WriteAllText($path,($value|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))}
try {
 $request=[Console]::In.ReadToEnd()|ConvertFrom-Json
 if($request.mode -eq 'prepare'){
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Path]::GetFullPath($request.archive)
  $destination=[IO.Path]::GetFullPath($request.destination)
  if([IO.Directory]::Exists($destination)){throw 'Preparation directory already exists'}
  $zip=[IO.Compression.ZipFile]::OpenRead($archive)
  try {
   if($zip.Entries.Count -gt 10000){throw 'Too many package entries'}
   $total=0L;$seen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
   foreach($entry in $zip.Entries){
    $name=$entry.FullName.Replace('\','/')
    if($name -match '(^/|:|\x00|(^|/)\.\.?(/|$)|[<>"|?*])' -or $name -match '(?i)(^|/)(Toccata-data|electron-profile)(/|$)|app-identity\.key|\.sqlite($|-)'){throw 'Unsafe package entry'}
    foreach($part in $name.Split('/')){if($part -and ($part -match '[ .]$' -or $part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)')){throw 'Unsafe Windows package name'}}
    if(-not $seen.Add($name.TrimEnd('/'))){throw 'Duplicate package path'}
    if((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000){throw 'Package links are not allowed'}
    $total+=$entry.Length;if($total -gt 2147483648 -or $entry.Length -gt 1073741824){throw 'Package is too large'}
   }
   $programs=@($zip.Entries|Where-Object {$_.FullName.Replace('\','/') -match '(^|/)Toccata\.exe$'})
   if($programs.Count -ne 1){throw 'Package must contain one Toccata executable'}
   $exeName=$programs[0].FullName.Replace('\','/')
   $prefix=$exeName.Substring(0,$exeName.Length-'Toccata.exe'.Length)
   if(-not ($zip.Entries|Where-Object {$_.FullName.Replace('\','/') -eq ($prefix+'resources/app.asar')})){throw 'Application resources are missing'}
   [IO.Directory]::CreateDirectory($destination)|Out-Null
   $root=$destination.TrimEnd('\')+'\'
   foreach($entry in $zip.Entries){
    $name=$entry.FullName.Replace('\','/');if(-not $name.StartsWith($prefix,[StringComparison]::Ordinal)){continue}
    $relative=$name.Substring($prefix.Length);if(-not $relative){continue}
    $target=[IO.Path]::GetFullPath([IO.Path]::Combine($destination,$relative.Replace('/','\')))
    if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Package path escapes destination'}
    if($name.EndsWith('/')){[IO.Directory]::CreateDirectory($target)|Out-Null;continue}
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)
   }
   $stream=[IO.File]::OpenRead([IO.Path]::Combine($destination,'Toccata.exe'));$reader=New-Object IO.BinaryReader $stream
   try{
    if($reader.ReadUInt16() -ne 0x5A4D){throw 'Executable is not a Windows PE file'}
    $stream.Position=0x3C;$offset=$reader.ReadInt32();if($offset -lt 0 -or $offset -gt $stream.Length-6){throw 'Invalid PE header'}
    $stream.Position=$offset;if($reader.ReadUInt32() -ne 0x00004550 -or $reader.ReadUInt16() -ne 0x8664){throw 'Package is not Windows x64'}
   }finally{$reader.Dispose();$stream.Dispose()}
   [Console]::Out.WriteLine((@{prepared=$destination}|ConvertTo-Json -Compress))
  }finally{$zip.Dispose()}
 }elseif($request.mode -eq 'install'){
  $target=[IO.Path]::GetFullPath($request.target)
  $source=[IO.Path]::GetFullPath($request.source)
  $result=[IO.Path]::GetFullPath($request.result)
  $parent=[IO.Path]::GetDirectoryName($target)
  if(-not $parent -or $target -eq $source -or [IO.Path]::GetFileName($target) -eq 'Toccata-data' -or -not [IO.File]::Exists([IO.Path]::Combine($source,'Toccata.exe')) -or -not [IO.File]::Exists([IO.Path]::Combine($target,'Toccata.exe'))){throw 'Invalid installation directories'}
  # Wait for the exact original process before touching the program directory.
  $deadline=[DateTime]::UtcNow.AddSeconds(45)
  while(Get-Process -Id $request.pid -ErrorAction SilentlyContinue){if([DateTime]::UtcNow -gt $deadline){throw 'Application did not exit'};Start-Sleep -Milliseconds 200}
  $backup=[IO.Path]::Combine($parent,'.Toccata-update-backup-'+[Guid]::NewGuid().ToString('N'))
  $incoming=[IO.Path]::Combine($parent,'.Toccata-update-staged-'+[Guid]::NewGuid().ToString('N'))
  $installed=$false;$launched=$null
  try{
   [IO.Directory]::CreateDirectory($incoming)|Out-Null
   Get-ChildItem -LiteralPath $source -Force|Copy-Item -Destination $incoming -Recurse -Force
   if(-not [IO.File]::Exists([IO.Path]::Combine($incoming,'Toccata.exe'))){throw 'Staged executable is missing'}
   [IO.Directory]::Move($target,$backup)
   [IO.Directory]::Move($incoming,$target);$installed=$true
   $newExe=[IO.Path]::Combine($target,'Toccata.exe')
   $launched=Start-Process -FilePath $newExe -WorkingDirectory $target -WindowStyle Hidden -PassThru
   Start-Sleep -Seconds 3
   if($launched.HasExited){throw 'Updated application exited during startup'}
   Save-Result $result @{status='installed';backup=$backup}
  }catch{
   $message=$_.Exception.Message
   if($launched -and -not $launched.HasExited){Stop-Process -Id $launched.Id -Force -ErrorAction SilentlyContinue}
   if($installed -and [IO.Directory]::Exists($target)){[IO.Directory]::Move($target,$incoming)}
   if([IO.Directory]::Exists($backup)){[IO.Directory]::Move($backup,$target)}
   Save-Result $result @{status='rolled-back';message=$message}
   Start-Process -FilePath ([IO.Path]::Combine($target,'Toccata.exe')) -WorkingDirectory $target -WindowStyle Hidden|Out-Null
  }
 }else{throw 'Unknown updater operation'}
}catch{
 if($request -and $request.mode -eq 'install' -and $request.result){try{Save-Result $request.result @{status='error';message=$_.Exception.Message}}catch{}}
 [Console]::Out.WriteLine('{"error":"Windows update operation failed"}')
 exit 1
}
