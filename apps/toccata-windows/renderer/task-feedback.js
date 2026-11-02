(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToccataTaskFeedback = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function create({getTask, move, onError = () => {}, AudioCtor} = {}) {
        if (typeof getTask !== 'function' || typeof move !== 'function') {
            throw new TypeError('Task feedback requires getTask and move callbacks');
        }
        let surface = null, sourceId = null, sourceRow = null, targetRow = null;
        let moving = false, destroyed = false, audio = null, playing = false;
        let playPending = false, playRun = 0;
        const timers = new Set();
        const report = error => { try { onError(error); } catch (_) {} };
        const rows = () => surface ? [...surface.querySelectorAll('.task-row')] : [];
        const view = () => surface?.defaultView || surface?.ownerDocument?.defaultView || globalThis;
        const markerRoot = () => surface?.documentElement || surface;

        function clearTarget() {
            targetRow?.classList.remove('drop-before', 'drop-after');
            targetRow = null;
        }
        function clearDrag() {
            clearTarget();
            sourceRow?.classList.remove('dragging');
            for (const row of rows()) row.classList.remove('dragging', 'drop-before', 'drop-after');
            markerRoot()?.classList?.remove('task-reordering');
            sourceId = sourceRow = null;
        }
        function eventRow(event) {
            const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
            const row = target?.closest?.('.task-row[draggable]');
            return row && (!surface.contains || surface.contains(row)) ? row : null;
        }
        function validTarget(row) {
            if (!sourceId || !row || row.dataset.id === sourceId) return false;
            const source = getTask(sourceId), target = getTask(row.dataset.id);
            return !!source && !!target && source.parent_id != null && target.parent_id === source.parent_id &&
                (source.completed_at != null) === (target.completed_at != null);
        }
        function placement(event, row) {
            const rect = row.getBoundingClientRect();
            return Number(event.clientY) < rect.top + rect.height / 2 ? 'before' : 'after';
        }
        function settle(id) {
            if (!surface || view().matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
            const moved = rows().filter(row => row.dataset.id === id);
            for (const row of moved) row.classList.add('task-drop-settled');
            const timer = setTimeout(() => {
                timers.delete(timer);
                for (const row of moved) row.classList.remove('task-drop-settled');
            }, 240);
            timers.add(timer);
        }
        function dragstart(event) {
            const row = eventRow(event), task = row && getTask(row.dataset.id);
            clearDrag();
            if (destroyed || moving || !task || task.parent_id == null) {
                if (row) event.preventDefault();
                return;
            }
            sourceId = task.id;
            sourceRow = row;
            row.classList.add('dragging');
            markerRoot()?.classList?.add('task-reordering');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', sourceId);
            }
        }
        function dragover(event) {
            if (!sourceId) return;
            const row = eventRow(event);
            clearTarget();
            if (!validTarget(row)) {
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
                return;
            }
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            targetRow = row;
            row.classList.add('drop-' + placement(event, row));
        }
        function dragleave(event) {
            if (targetRow && !targetRow.contains(event.relatedTarget)) clearTarget();
        }
        async function drop(event) {
            const row = eventRow(event);
            if (!validTarget(row) || moving || destroyed) { clearDrag(); return; }
            event.preventDefault();
            const request = {sourceId, targetId:row.dataset.id, placement:placement(event, row)};
            clearDrag();
            moving = true;
            try {
                const saved = await move(request);
                if (saved === true && !destroyed) settle(request.sourceId);
            } catch (error) { report(error); }
            finally { moving = false; }
        }

        const listeners = {dragstart, dragover, dragleave, drop, dragend:clearDrag};
        function install(root) {
            if (destroyed) return api;
            const next = root || (typeof document !== 'undefined' ? document : null);
            if (!next?.addEventListener || !next?.querySelectorAll) throw new TypeError('A DOM surface is required');
            if (surface === next) return api;
            if (surface) {
                clearDrag();
                for (const [name, handler] of Object.entries(listeners)) surface.removeEventListener(name, handler);
            }
            surface = next;
            for (const [name, handler] of Object.entries(listeners)) surface.addEventListener(name, handler);
            return api;
        }
        function resetPlayback() {
            playRun++;
            playing = playPending = false;
        }
        function playCompletion() {
            if (destroyed || playing || playPending) return false;
            try {
                if (!audio) {
                    const Constructor = AudioCtor || globalThis.Audio;
                    if (typeof Constructor !== 'function') return false;
                    audio = new Constructor('./task-completed.wav');
                    audio.volume = 0.6;
                    audio.addEventListener?.('ended', resetPlayback);
                    audio.addEventListener?.('error', resetPlayback);
                }
                if (audio.ended) audio.currentTime = 0;
                playing = playPending = true;
                const run = ++playRun;
                const result = audio.play();
                Promise.resolve(result).then(() => {
                    if (run === playRun) playPending = false;
                }, () => {
                    if (run === playRun) resetPlayback();
                });
                return true;
            } catch (_) { resetPlayback(); return false; }
        }
        function destroy() {
            if (destroyed) return;
            destroyed = true;
            clearDrag();
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
            for (const row of rows()) row.classList.remove('task-drop-settled');
            if (surface) for (const [name, handler] of Object.entries(listeners)) surface.removeEventListener(name, handler);
            surface = null;
            resetPlayback();
            if (audio) {
                audio.removeEventListener?.('ended', resetPlayback);
                audio.removeEventListener?.('error', resetPlayback);
                try { audio.pause(); } catch (_) {}
                audio = null;
            }
        }
        const api = {install, playCompletion, destroy};
        return api;
    }

    return {create};
});
