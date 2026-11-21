package com.camelstudio.runner;

import java.io.StringReader;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import javax.xml.transform.stream.StreamSource;

import net.sf.saxon.s9api.Processor;
import net.sf.saxon.s9api.QName;
import net.sf.saxon.s9api.SaxonApiException;
import net.sf.saxon.s9api.Serializer;
import net.sf.saxon.s9api.XQueryCompiler;
import net.sf.saxon.s9api.XQueryEvaluator;
import net.sf.saxon.s9api.XdmAtomicValue;
import net.sf.saxon.s9api.XdmNode;
import net.sf.saxon.s9api.Xslt30Transformer;
import net.sf.saxon.s9api.XsltCompiler;
import net.sf.saxon.s9api.XsltExecutable;
import org.springframework.stereotype.Service;

/** XSLT 3.0 and XQuery 3.1 with Saxon-HE, optionally with an execution trace. */
@Service
public class TransformService {

    private static final int MAX_INPUT = 2_000_000;

    public Dto.TransformResult transform(Dto.TransformRequest req) {
        long t0 = System.nanoTime();
        List<String> messages = new ArrayList<>();
        List<Dto.TraceEntry> trace = Boolean.TRUE.equals(req.trace()) ? new ArrayList<>() : null;
        if (req.source() == null || req.input() == null || req.source().length() > MAX_INPUT || req.input().length() > MAX_INPUT) {
            return new Dto.TransformResult(false, "", messages, 0, null, new Dto.TransformError("Missing or too large input", null));
        }
        Processor proc = new Processor(false);
        StringWriter out = new StringWriter();
        try {
            XdmNode doc = proc.newDocumentBuilder().build(new StreamSource(new StringReader(req.input())));
            if ("xquery".equals(req.kind())) {
                XQueryCompiler qc = proc.newXQueryCompiler();
                qc.setCompileWithTracing(trace != null);
                XQueryEvaluator ev = qc.compile(req.source()).load();
                ev.setContextItem(doc);
                params(req.params()).forEach(ev::setExternalVariable);
                if (trace != null) {
                    ev.setTraceListener(new CollectingTraceListener(trace));
                }
                Serializer ser = proc.newSerializer(out);
                ser.setOutputProperty(Serializer.Property.INDENT, "yes");
                ev.run(ser);
            } else {
                XsltCompiler xc = proc.newXsltCompiler();
                xc.setCompileWithTracing(trace != null);
                XsltExecutable exe = xc.compile(new StreamSource(new StringReader(req.source())));
                Xslt30Transformer tr = exe.load30();
                tr.setStylesheetParameters(params(req.params()));
                tr.setMessageHandler(m -> messages.add(m.getContent().getStringValue()));
                if (trace != null) {
                    tr.setTraceListener(new CollectingTraceListener(trace));
                }
                tr.applyTemplates(doc, tr.newSerializer(out));
            }
            return new Dto.TransformResult(true, out.toString(), messages, (System.nanoTime() - t0) / 1_000_000, trace, null);
        } catch (SaxonApiException e) {
            Integer line = e.getLineNumber() > 0 ? e.getLineNumber() : null;
            return new Dto.TransformResult(false, out.toString(), messages, (System.nanoTime() - t0) / 1_000_000, trace, new Dto.TransformError(e.getMessage(), line));
        } catch (RuntimeException e) {
            return new Dto.TransformResult(false, out.toString(), messages, (System.nanoTime() - t0) / 1_000_000, trace, new Dto.TransformError(String.valueOf(e.getMessage()), null));
        }
    }

    private static Map<QName, net.sf.saxon.s9api.XdmValue> params(Map<String, String> p) {
        Map<QName, net.sf.saxon.s9api.XdmValue> out = new java.util.HashMap<>();
        if (p != null) {
            p.forEach((k, v) -> out.put(new QName(k), new XdmAtomicValue(v)));
        }
        return out;
    }
}
