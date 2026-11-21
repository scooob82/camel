import JSZip from 'jszip';
import { COMPONENT_BY_SCHEME } from './catalog';
import { docsMarkdown } from './docs';
import { className, toJava } from './java';
import { isKnown, schemeOf, walkSteps, type CamelFile } from './model';
import { toXml } from './xml';
import { toYaml } from './yaml';

/** Versions used in generated projects. Update when bumping the supported Camel line. */
export const VERSIONS = { camel: '4.10.0', springBoot: '3.4.4', java: '21' };

export type ExportDsl = 'yaml' | 'xml' | 'java';

export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'camel-project'
  );
}

const FORMAT_STARTERS: Record<string, string> = {
  json: 'camel-jackson-starter',
  jacksonXml: 'camel-jacksonxml-starter',
  jaxb: 'camel-jaxb-starter',
  csv: 'camel-csv-starter',
  base64: 'camel-base64-starter',
};
const LANGUAGE_STARTERS: Record<string, string> = { jsonpath: 'camel-jsonpath-starter', xpath: 'camel-xpath-starter' };

/** Spring Boot starters needed by the routes in the file. */
export function requiredStarters(file: CamelFile, dsl: ExportDsl): string[] {
  const set = new Set<string>(['camel-spring-boot-starter']);
  if (dsl === 'yaml') set.add('camel-yaml-dsl-starter');
  if (dsl === 'xml') set.add('camel-xml-io-dsl-starter');
  const addUri = (uri: string) => {
    const s = schemeOf(uri);
    if (!s) return;
    set.add(COMPONENT_BY_SCHEME[s]?.starter ?? `camel-${s}-starter`);
  };
  file.routes.forEach((r) => addUri(r.from.uri));
  walkSteps(file, (s) => {
    if (!isKnown(s)) return;
    if (s.props.uri) addUri(s.props.uri);
    if ((s.type === 'marshal' || s.type === 'unmarshal') && FORMAT_STARTERS[s.props.format]) set.add(FORMAT_STARTERS[s.props.format]);
    if (s.type === 'bean') set.add('camel-bean-starter');
    const langs = [s.expression?.language, ...(s.branches ?? []).map((b) => b.expression?.language)];
    for (const l of langs) if (l && LANGUAGE_STARTERS[l]) set.add(LANGUAGE_STARTERS[l]);
  });
  return [...set].sort((a, b) => (a === 'camel-spring-boot-starter' ? -1 : b === 'camel-spring-boot-starter' ? 1 : a.localeCompare(b)));
}

/** {{property}} placeholders used anywhere in the routes. */
export function placeholders(file: CamelFile): string[] {
  const found = new Set<string>();
  const json = JSON.stringify(file);
  for (const m of json.matchAll(/\{\{([^}:]+)(?::[^}]*)?\}\}/g)) found.add(m[1].trim());
  return [...found].sort();
}

export function pomXml(artifactId: string, name: string, starters: string[]): string {
  const deps = starters
    .map((a) => `        <dependency>\n            <groupId>org.apache.camel.springboot</groupId>\n            <artifactId>${a}</artifactId>\n        </dependency>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>${VERSIONS.springBoot}</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>${artifactId}</artifactId>
    <version>1.0.0-SNAPSHOT</version>
    <name>${name.replace(/[<&>]/g, '')}</name>

    <properties>
        <java.version>${VERSIONS.java}</java.version>
        <camel.version>${VERSIONS.camel}</camel.version>
    </properties>

    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.apache.camel.springboot</groupId>
                <artifactId>camel-spring-boot-bom</artifactId>
                <version>\${camel.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <dependencies>
${deps}
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>
        <dependency>
            <groupId>org.apache.camel</groupId>
            <artifactId>camel-test-spring-junit5</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
`;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export function springBootProject(file: CamelFile, projectName: string, dsl: ExportDsl = 'yaml'): GeneratedFile[] {
  const artifact = slugify(projectName);
  const pkg = 'com.example.integration';
  const pkgPath = pkg.replace(/\./g, '/');
  const props = placeholders(file);
  const files: GeneratedFile[] = [
    { path: 'pom.xml', content: pomXml(artifact, projectName, requiredStarters(file, dsl)) },
    {
      path: `src/main/java/${pkgPath}/Application.java`,
      content: `package ${pkg};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
`,
    },
    {
      path: 'src/main/resources/application.properties',
      content: [
        `spring.application.name=${artifact}`,
        'camel.springboot.main-run-controller=true',
        'management.endpoints.web.exposure.include=health,info',
        '',
        ...(props.length ? ['# Placeholders used by the routes — fill in real values (or use environment variables)', ...props.map((p) => `${p}=`)] : []),
        '',
      ].join('\n'),
    },
    {
      path: 'Dockerfile',
      content: `FROM eclipse-temurin:${VERSIONS.java}-jre
WORKDIR /app
COPY target/${artifact}-1.0.0-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
`,
    },
    { path: '.gitignore', content: 'target/\n.idea/\n*.iml\n.vscode/\n' },
    {
      path: 'README.md',
      content: `# ${projectName}

Generated by the Integration Studio for Apache Camel.

- Apache Camel ${VERSIONS.camel} · Spring Boot ${VERSIONS.springBoot} · Java ${VERSIONS.java}
- Routes: ${dsl === 'java' ? `\`src/main/java/${pkgPath}/${className(projectName)}.java\`` : `\`src/main/resources/camel/routes.camel.${dsl}\``}

## Run

\`\`\`bash
mvn spring-boot:run
\`\`\`

## Build a container

\`\`\`bash
mvn package
docker build -t ${artifact} .
\`\`\`

See \`docs/ROUTES.md\` for the generated route documentation.
`,
    },
    { path: 'docs/ROUTES.md', content: docsMarkdown(file, projectName) },
  ];
  if (dsl === 'yaml') files.push({ path: 'src/main/resources/camel/routes.camel.yaml', content: toYaml(file) });
  if (dsl === 'xml') files.push({ path: 'src/main/resources/camel/routes.camel.xml', content: toXml(file) });
  if (dsl === 'java') files.push({ path: `src/main/java/${pkgPath}/${className(projectName)}.java`, content: toJava(file, projectName, pkg) });
  return files;
}

export function routeFiles(file: CamelFile, projectName: string): GeneratedFile[] {
  const slug = slugify(projectName);
  return [
    { path: `${slug}.camel.yaml`, content: toYaml(file) },
    { path: `${slug}.camel.xml`, content: toXml(file) },
    { path: `${className(projectName)}.java`, content: toJava(file, projectName) },
    { path: 'ROUTES.md', content: docsMarkdown(file, projectName) },
  ];
}

export async function zip(files: GeneratedFile[], root?: string): Promise<Blob> {
  const z = new JSZip();
  for (const f of files) z.file(root ? `${root}/${f.path}` : f.path, f.content);
  return z.generateAsync({ type: 'blob' });
}
