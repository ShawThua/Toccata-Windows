(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ToccataTaskFeedback = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function create({getTask, move, onError = () => {}, AudioCtor} = {}) {
        if (typeof getTask !== 'function' || typeof move !== 'function') {
            throw new TypeError('Task feedback requires getTask and move callbacks');
        }
        let surface = null, sourceId = null, sourceRow = null, targetRow = null, dragScope = null;
        let moving = false, destroyed = false, audio = null, playing = false;
        let playPending = false, playRun = 0;
        const timers = new Set();
        const report = error => { try { onError(error); } catch (_) {} };
        const rows = () => surface ? [...(dragScope || surface).querySelectorAll('.task-row')] : [];
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
            dragScope = null;
        }
        function eventRow(event) {
            const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
            const row = target?.closest?.('.task-row[draggable]');
            return row && (!surface.contains || surface.contains(row)) && (!dragScope || dragScope.contains(row)) ? row : null;
        }
        function rootTask(task) {
            const seen = new Set();
            while (task?.parent_id != null && !seen.has(task.id)) {
                seen.add(task.id);
                task = getTask(task.parent_id);
            }
            return task || null;
        }
        function targetFor(event) {
            const row = eventRow(event), source = getTask(sourceId);
            if (!row || !source || source.parent_id != null) return row;
            const root = rootTask(getTask(row.dataset.id));
            return rows().find(item => item.dataset.id === root?.id) || row;
        }
        function validTarget(row) {
            if (!sourceId || !row || row.dataset.id === sourceId) return false;
            const source = getTask(sourceId), target = getTask(row.dataset.id);
            return !!source && !!target && target.parent_id === source.parent_id &&
                (source.completed_at != null) === (target.completed_at != null) &&
                (source.parent_id != null || !!source.pinned === !!target.pinned);
        }
        function groupLast(row) {
            const items = rows(), start = items.indexOf(row);
            let last = row;
            for (let i = start + 1; i < items.length; i++) {
                const task = getTask(items[i].dataset.id);
                if (!task || task.parent_id == null || rootTask(task)?.id !== row.dataset.id) break;
                last = items[i];
            }
            return last;
        }
        function placement(event, row) {
            const rect = row.getBoundingClientRect();
            let bottom = rect.top + rect.height;
            if (getTask(sourceId)?.parent_id == null) {
                const last = groupLast(row).getBoundingClientRect();
                bottom = Math.max(bottom, last.top + last.height);
            }
            return Number(event.clientY) < (rect.top + bottom) / 2 ? 'before' : 'after';
        }
        function resolveTarget(event) {
            const row = targetFor(event);
            if (row) return {row, where:placement(event, row)};
            if (!sourceId || getTask(sourceId)?.parent_id != null ||
                !(dragScope || surface)?.contains?.(event.target)) return null;
            const roots = rows().filter(item => getTask(item.dataset.id)?.parent_id == null);
            const y = Number(event.clientY);
            for (let i = 0; i + 1 < roots.length; i++) {
                const previous = roots[i], next = roots[i + 1];
                const prevRect = groupLast(previous).getBoundingClientRect(), nextRect = next.getBoundingClientRect();
                const bottom = prevRect.top + prevRect.height;
                if (y >= bottom && y <= nextRect.top) {
                    return y - bottom < nextRect.top - y ? {row:previous,where:'after'} : {row:next,where:'before'};
                }
            }
            return null;
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
            if (destroyed || moving || !task) {
                if (row) event.preventDefault();
                return;
            }
            sourceId = task.id;
            sourceRow = row;
            const container = row.closest?.('.list-scroll,.tray-scroll,.detail-content,.floating-content');
            dragScope = container?.querySelectorAll && container?.contains ? container : null;
            row.classList.add('dragging');
            if (task.parent_id == null) for (const item of rows()) {
                if (rootTask(getTask(item.dataset.id))?.id === task.id) item.classList.add('dragging');
            }
            markerRoot()?.classList?.add('task-reordering');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', sourceId);
            }
        }
        function dragover(event) {
            if (!sourceId) return;
            const target = resolveTarget(event), row = target?.row;
            clearTarget();
            if (!validTarget(row)) {
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
                return;
            }
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            const where = target.where;
            targetRow = where === 'after' && getTask(sourceId)?.parent_id == null ? groupLast(row) : row;
            targetRow.classList.add('drop-' + where);
        }
        function dragleave(event) {
            if (targetRow && !targetRow.contains(event.relatedTarget)) clearTarget();
        }
        async function drop(event) {
            const target = resolveTarget(event), row = target?.row;
            if (!validTarget(row) || moving || destroyed) { clearDrag(); return; }
            event.preventDefault();
            const request = {sourceId, targetId:row.dataset.id, placement:target.where};
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
