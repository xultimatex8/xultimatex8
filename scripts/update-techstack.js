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

const TECH = {
  cs: { name: "C#", icon: "cs", category: "languages" },
  java: { name: "Java", icon: "java", category: "languages" },
  python: { name: "Python", icon: "python", category: "languages" },
  ts: { name: "TypeScript", icon: "ts", category: "languages" },
  js: { name: "JavaScript", icon: "js", category: "languages" },
  html: { name: "HTML", icon: "html", category: "languages" },
  css: { name: "CSS", icon: "css", category: "languages" },

  dotnet: { name: ".NET", icon: "dotnet", category: "backend" },
  spring: { name: "Spring", icon: "spring", category: "backend" },
  nestjs: { name: "NestJS", icon: "nestjs", category: "backend" },
  express: { name: "Express", icon: "express", category: "backend" },
  django: { name: "Django", icon: "django", category: "backend" },
  fastapi: { name: "FastAPI", icon: "fastapi", category: "backend" },
  postgres: { name: "PostgreSQL", icon: "postgres", category: "backend" },
  mysql: { name: "MySQL", icon: "mysql", category: "backend" },
  mongodb: { name: "MongoDB", icon: "mongodb", category: "backend" },
  redis: { name: "Redis", icon: "redis", category: "backend" },
  neo4j: { name: "Neo4j", icon: "neo4j", category: "backend" },
  socketio: { name: "Socket.IO", icon: null, category: "backend" },

  react: { name: "React", icon: "react", category: "frontend" },
  nextjs: { name: "Next.js", icon: "nextjs", category: "frontend" },
  angular: { name: "Angular", icon: "angular", category: "frontend" },
  vue: { name: "Vue", icon: "vue", category: "frontend" },
  tailwind: { name: "Tailwind CSS", icon: "tailwind", category: "frontend" },

  docker: { name: "Docker", icon: "docker", category: "tools" },
  git: { name: "Git", icon: "git", category: "tools" },
  github: { name: "GitHub", icon: "github", category: "tools" },
};

const GITHUB_LANG_TO_TECH = {
  "C#": "cs",
  "Java": "java",
  "Python": "python",
  "TypeScript": "ts",
  "JavaScript": "js",
  "HTML": "html",
  "CSS": "css"
};

const MANIFEST_RULES = [
  { file: "package.json", contains: [
    { match: /"react"\s*:/, tech: "react" },
    { match: /"next"\s*:/, tech: "nextjs" },
    { match: /"@angular\/core"\s*:/, tech: "angular" },
    { match: /"vue"\s*:/, tech: "vue" },
    { match: /"@nestjs\/core"\s*:/, tech: "nestjs" },
    { match: /"express"\s*:/, tech: "express" },
    { match: /"tailwindcss"\s*:/, tech: "tailwind" },
    { match: /"socket\.io"\s*:/, tech: "socketio" },
  ]},
  { file: "requirements.txt", contains: [
    { match: /fastapi/i, tech: "fastapi" },
    { match: /django/i, tech: "django" },
  ]},
  { file: "pyproject.toml", contains: [
    { match: /fastapi/i, tech: "fastapi" },
    { match: /django/i, tech: "django" },
  ]},
  { file: "pom.xml", contains: [
    { match: /spring-boot|org\.springframework/i, tech: "spring" },
  ]},
  { file: "build.gradle", contains: [
    { match: /spring-boot|org\.springframework/i, tech: "spring" },
  ]},
  { file: "build.gradle.kts", contains: [
    { match: /spring-boot|org\.springframework/i, tech: "spring" },
  ]},
  { file: "docker-compose.yml", contains: [
    { match: /postgres/i, tech: "postgres" },
    { match: /neo4j/i, tech: "neo4j" },
    { match: /redis/i, tech: "redis" },
    { match: /mysql/i, tech: "mysql" },
    { match: /mongo/i, tech: "mongodb" },
  ]},
  { file: "docker-compose.yaml", contains: [
    { match: /postgres/i, tech: "postgres" },
    { match: /neo4j/i, tech: "neo4j" },
    { match: /redis/i, tech: "redis" },
    { match: /mysql/i, tech: "mysql" },
    { match: /mongo/i, tech: "mongodb" },
  ]},
];

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
  const found = new Set();
  const [owner, name] = [repo.owner.login, repo.name];

  const langs = await gh(`/repos/${owner}/${name}/languages`);

  if (langs) {
    console.log(`${repo.full_name} languages:`, Object.keys(langs));

    for (const lang of Object.keys(langs)) {
      const tech = GITHUB_LANG_TO_TECH[lang];

      if (tech) found.add(tech);
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
          found.add(c.tech);
        }
      }
    }
  }

  if (tree && tree.tree) {
    const hasDockerfile = tree.tree.some(
      (file) => file.type === "blob" && /(^|\/)Dockerfile$/.test(file.path)
    );

    if (hasDockerfile) {
      found.add("docker");
    }
  }

  return found;
}

function formatCategory(title, technologies) {
  const detected = Array.from(technologies)
    .map((tech) => TECH[tech])
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (detected.length === 0) return "";

  const icons = detected
    .filter((tech) => tech.icon)
    .map((tech) => tech.icon);

  const text = detected
    .filter((tech) => !tech.icon)
    .map((tech) => `\`${tech.name}\``)
    .join(" · ");

  let output = `### ${title}\n`;

  if (icons.length > 0) {
    output += `<p align="left">\n`;
    output += `  <img src="https://skillicons.dev/icons?i=${icons.join(",")}" alt="${title}" />\n`;
    output += `</p>\n`;
  }

  if (text) {
    output += `${text}\n`;
  }

  return `${output}\n`;
}

async function main() {
  const repos = await listRepos();

  const allTech = new Set(["git", "github"]);

  for (const repo of repos) {
    try {
      const tech = await detectTechForRepo(repo);

      for (const item of tech) {
        allTech.add(item);
      }
    } catch (err) {
      console.warn(`Warning: could not analyze ${repo.full_name}: ${err.message}`);
    }
  }

  const categories = {
    languages: new Set(),
    backend: new Set(),
    frontend: new Set(),
    tools: new Set(),
  };

  for (const tech of allTech) {
    if (TECH[tech]) {
      categories[TECH[tech].category].add(tech);
    }
  }

  const techStack = [
    formatCategory("Languages", categories.languages),
    formatCategory("Backend", categories.backend),
    formatCategory("Frontend", categories.frontend),
    formatCategory("Tools", categories.tools),
  ]
    .filter(Boolean)
    .join("\n");

  let readme = readFileSync(README_PATH, "utf8");

  readme = readme.replace(
    /<!--TECH-STACK:START-->[\s\S]*?<!--TECH-STACK:END-->/,
    `<!--TECH-STACK:START-->
  ${techStack}<!--TECH-STACK:END-->`
  );

  writeFileSync(README_PATH, readme);

  console.log("Detected tech stack:", Array.from(allTech));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});