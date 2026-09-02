import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const USERNAME = process.env.GITHUB_USERNAME;
const TOKEN = process.env.GH_TOKEN;

const README_PATH = join(__dirname, "..", "README.md");

const API = "https://api.github.com";

if (!USERNAME || !TOKEN) {
  console.error("Missing GITHUB_USERNAME or GH_TOKEN environment variables.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": USERNAME,
};

const MANIFEST_RULES = [
  { file: "package.json", contains: [
    { match: /"react"\s*:/, tech: "React", category: "frontend" },
    { match: /"next"\s*:/, tech: "Next.js", category: "frontend" },
    { match: /"@angular\/core"\s*:/, tech: "Angular", category: "frontend" },
    { match: /"vue"\s*:/, tech: "Vue", category: "frontend" },
    { match: /"@nestjs\/core"\s*:/, tech: "NestJS", category: "backend" },
    { match: /"express"\s*:/, tech: "Express", category: "backend" },
    { match: /"tailwindcss"\s*:/, tech: "Tailwind CSS", category: "frontend" },
    { match: /"socket\.io"\s*:/, tech: "Socket.IO", category: "backend" },
  ]},
  { file: "requirements.txt", contains: [
    { match: /fastapi/i, tech: "FastAPI", category: "backend" },
    { match: /django/i, tech: "Django", category: "backend" },
    { match: /flask/i, tech: "Flask", category: "backend" },
  ]},
  { file: "pyproject.toml", contains: [
    { match: /fastapi/i, tech: "FastAPI", category: "backend" },
    { match: /django/i, tech: "Django", category: "backend" },
    { match: /flask/i, tech: "Flask", category: "backend" },
  ]},
  { file: "pom.xml", contains: [
    { match: /spring-boot|org\.springframework/i, tech: "Spring", category: "backend" },
  ]},
  { file: "build.gradle", contains: [
    { match: /spring-boot|org\.springframework/i, tech: "Spring", category: "backend" },
  ]},
  { file: "build.gradle.kts", contains: [
    { match: /spring-boot|org\.springframework/i, tech: "Spring", category: "backend" },
  ]},
  { file: "docker-compose.yml", contains: [
    { match: /postgres/i, tech: "PostgreSQL", category: "backend" },
    { match: /neo4j/i, tech: "Neo4j", category: "backend" },
    { match: /redis/i, tech: "Redis", category: "backend" },
    { match: /mysql/i, tech: "MySQL", category: "backend" },
    { match: /mongo/i, tech: "MongoDB", category: "backend" },
  ]},
  { file: "docker-compose.yaml", contains: [
    { match: /postgres/i, tech: "PostgreSQL", category: "backend" },
    { match: /neo4j/i, tech: "Neo4j", category: "backend" },
    { match: /redis/i, tech: "Redis", category: "backend" },
    { match: /mysql/i, tech: "MySQL", category: "backend" },
    { match: /mongo/i, tech: "MongoDB", category: "backend" },
  ]},
];

const GITHUB_LANG_TO_TECH = {
  "C#": { tech: "C#", category: "languages" },
  "Java": { tech: "Java", category: "languages" },
  "Python": { tech: "Python", category: "languages" },
  "TypeScript": { tech: "TypeScript", category: "languages" },
  "JavaScript": { tech: "JavaScript", category: "languages" },
  "HTML": { tech: "HTML", category: "languages" },
  "CSS": { tech: "CSS", category: "languages" },
};

async function gh(pathname) {
  const res = await fetch(`${API}${pathname}`, { headers });

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} at ${pathname}`);
  }

  return res.json();
}

async function listRepos() {
  const repos = [];
  let page = 1;

  while (true) {
    const batch = await gh(`/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&visibility=public`);

    if (!batch || batch.length === 0) break;

    repos.push(...batch.filter((r) => !r.fork));
    page++;
  }

  return repos;
}

async function getFileContent(owner, repo, filePath) {
  const data = await gh(`/repos/${owner}/${repo}/contents/${filePath}`);

  if (!data || !data.content) return null;

  return Buffer.from(data.content, "base64").toString("utf8");
}

async function detectTechForRepo(repo) {
  const found = {
    languages: new Set(),
    backend: new Set(),
    frontend: new Set(),
    tools: new Set(),
  };

  const [owner, name] = [repo.owner.login, repo.name];

  const langs = await gh(`/repos/${owner}/${name}/languages`);

  if (langs) {
    console.log(`${repo.full_name} languages:`, Object.keys(langs));

    for (const lang of Object.keys(langs)) {
      const detected = GITHUB_LANG_TO_TECH[lang];

      if (detected) {
        found[detected.category].add(detected.tech);
      }
    }
  }

  const tree = await gh(`/repos/${owner}/${name}/git/trees/${repo.default_branch}?recursive=1`);

  if (tree && tree.tree) {
    for (const file of tree.tree) {
      if (file.type !== "blob") continue;

      const rule = MANIFEST_RULES.find(
        (r) => file.path === r.file || file.path.endsWith(`/${r.file}`)
      );

      if (!rule) continue;

      const content = await getFileContent(owner, name, file.path);

      if (!content) continue;

      for (const c of rule.contains) {
        if (c.match.test(content)) {
          console.log(`${repo.full_name}: detected ${c.tech} from ${file.path}`);
          found[c.category].add(c.tech);
        }
      }
    }
  }

  const dockerfile = tree?.tree?.some(
    (file) => file.type === "blob" && /^(.+\/)?Dockerfile$/.test(file.path)
  );

  if (dockerfile) {
    found.tools.add("Docker");
  }

  return found;
}

function mergeTech(target, source) {
  for (const category of Object.keys(target)) {
    for (const tech of source[category]) {
      target[category].add(tech);
    }
  }
}

function formatCategory(title, technologies) {
  if (technologies.size === 0) return "";

  const items = Array.from(technologies).sort();

  return `### ${title}\n\n${items.map((tech) => `\`${tech}\``).join(" · ")}\n`;
}

async function main() {
  const repos = await listRepos();

  const allTech = {
    languages: new Set(),
    backend: new Set(),
    frontend: new Set(),
    tools: new Set(["Git", "GitHub"]),
  };

  for (const repo of repos) {
    try {
      const tech = await detectTechForRepo(repo);

      mergeTech(allTech, tech);
    } catch (err) {
      console.warn(`Warning: could not analyze ${repo.name}: ${err.message}`);
    }
  }

  const techStack = [
    formatCategory("Languages", allTech.languages),
    formatCategory("Backend", allTech.backend),
    formatCategory("Frontend", allTech.frontend),
    formatCategory("Tools", allTech.tools),
  ]
    .filter(Boolean)
    .join("\n");

  let readme = readFileSync(README_PATH, "utf8");

  readme = readme.replace(
    /<!--TECH-STACK:START-->[\s\S]*?<!--TECH-STACK:END-->/,
    `<!--TECH-STACK:START-->
    ${techStack}
    <!--TECH-STACK:END-->`
  );

  writeFileSync(README_PATH, readme);

  console.log("Detected tech stack:");
  console.log(techStack);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});