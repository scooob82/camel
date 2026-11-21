package com.camelstudio.runner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;

import org.junit.jupiter.api.Test;

class RouteRunnerTest {

    private final RouteRunner runner = new RouteRunner(5000, 1_000_000, 500, 2);
    private final TransformService transforms = new TransformService();

    @Test
    void runsAndTracesByNodeId() {
        String yaml = """
                - route:
                    id: r
                    from:
                      uri: direct:cas-start
                      steps:
                        - setBody:
                            id: s1
                            simple: "Hello ${body}"
                        - choice:
                            id: c1
                            when:
                              - id: w1
                                simple: "${header.vip} == 'true'"
                                steps:
                                  - to:
                                      id: s2
                                      uri: mock:vip
                        - to:
                            id: s3
                            uri: mock:out
                """;
        var res = runner.run(new Dto.RunRequest(yaml, "direct:cas-start", new Dto.RunInput("World", Map.of("vip", "true")), 3000));
        assertTrue(res.ok(), res.error());
        assertEquals("Hello World", res.output().body());
        assertTrue(res.trace().stream().anyMatch(e -> "s1".equals(e.nodeId())));
        assertTrue(res.trace().stream().anyMatch(e -> "s2".equals(e.nodeId())));
        assertEquals(1, res.mocks().stream().filter(m -> m.uri().equals("mock:vip")).findFirst().orElseThrow().count());
    }

    @Test
    void rejectsBlockedComponents() {
        var res = runner.run(new Dto.RunRequest("- from:\n    uri: direct:cas-start\n    steps:\n      - to:\n          uri: exec:ls\n", null, new Dto.RunInput("", Map.of()), 1000));
        assertFalse(res.ok());
        assertTrue(res.error().contains("exec"));
    }

    @Test
    void xslt3WithTrace() {
        String xsl = """
                <xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
                  <xsl:template match="/order"><total><xsl:value-of select="sum(line/@qty)"/></total></xsl:template>
                </xsl:stylesheet>""";
        var res = transforms.transform(new Dto.TransformRequest("xslt", xsl, "<order><line qty='2'/><line qty='3'/></order>", Map.of(), true));
        assertTrue(res.ok(), String.valueOf(res.error()));
        assertTrue(res.output().contains("<total>5</total>"));
        assertFalse(res.trace().isEmpty());
    }

    @Test
    void xquery() {
        var res = transforms.transform(new Dto.TransformRequest("xquery", "<n>{count(//line)}</n>", "<order><line/><line/></order>", Map.of(), false));
        assertTrue(res.ok(), String.valueOf(res.error()));
        assertTrue(res.output().contains("<n>2</n>"));
    }
}
