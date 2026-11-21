package com.camelstudio.runner;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;

import net.sf.saxon.Controller;
import net.sf.saxon.expr.Expression;
import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.lib.Logger;
import net.sf.saxon.lib.TraceListener;
import net.sf.saxon.om.Item;
import net.sf.saxon.trace.Traceable;
import net.sf.saxon.trans.Mode;

/**
 * Collects entered instructions with line numbers and timings (used for stepping through a
 * transformation and for the profiler). Written against the Saxon 12 TraceListener API.
 */
final class CollectingTraceListener implements TraceListener {

    private static final int MAX = 5_000;
    private final List<Dto.TraceEntry> out;
    private final Deque<long[]> stack = new ArrayDeque<>();

    CollectingTraceListener(List<Dto.TraceEntry> out) {
        this.out = out;
    }

    @Override
    public void setOutputDestination(Logger stream) {
    }

    @Override
    public void open(Controller controller) {
    }

    @Override
    public void close() {
    }

    @Override
    public void enter(Traceable info, Map<String, Object> properties, XPathContext context) {
        int index = out.size();
        if (index < MAX) {
            String name = info instanceof Expression e ? e.getExpressionName() : info.getClass().getSimpleName();
            int line = info.getLocation() != null ? info.getLocation().getLineNumber() : -1;
            int col = info.getLocation() != null ? info.getLocation().getColumnNumber() : -1;
            out.add(new Dto.TraceEntry(line, col > 0 ? col : null, name, stack.size(), null));
        }
        stack.push(new long[] { index, System.nanoTime() });
    }

    @Override
    public void leave(Traceable info) {
        long[] top = stack.poll();
        if (top != null && top[0] < out.size()) {
            Dto.TraceEntry e = out.get((int) top[0]);
            out.set((int) top[0], new Dto.TraceEntry(e.line(), e.column(), e.instruction(), e.depth(), (System.nanoTime() - top[1]) / 1_000_000));
        }
    }

    @Override
    public void startCurrentItem(Item currentItem) {
    }

    @Override
    public void endCurrentItem(Item currentItem) {
    }

    @Override
    public void startRuleSearch() {
    }

    @Override
    public void endRuleSearch(Object rule, Mode mode, Item item) {
    }
}
