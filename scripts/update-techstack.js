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
    { match: /"react"\s*:/, tech: "react" },
    { match: /"next"\s*:/, tech: "nextjs" },
    { match: /"@angular\/core"\s*:/, tech: "angular" },
    { match: /"vue"\s*:/, tech: "vue" },
    { match: /"@nestjs\/core"\s*:/, tech: "nestjs" },
    { match: /"express"\s*:/, tech: "express" },
    { match: /"tailwindcss"\s*:/, tech: "tailwind" },
    { match: /"socket\.io"\s*:/, tech: "socketio" },
    { match: /"typescript"\s*:/, tech: "ts" },
  ]},
  { file: "requirements.txt", contains: [
    { match: /fastapi/i, tech: "fastapi" },
    { match: /django/i, tech: "django" },
    { match: /flask/i, tech: "flask" },
  ]},
  { file: "pyproject.toml", contains: [
    { match: /fastapi/i, tech: "fastapi" },
    { match: /django/i, tech: "django" },
    { match: /flask/i, tech: "flask" },
  ]},
  { file: "pom.xml", contains: [
  { match: /<artifactId>\s*spring-boot-[^<]+<\/artifactId>/i, tech: "spring" },
  { match: /org\.springframework/i, tech: "spring" },
  ]},
  { file: "build.gradle", contains: [
  { match: /org\.springframework/i, tech: "spring" },
  { match: /spring-boot/i, tech: "spring" },
  ]},
  { file: "build.gradle.kts", contains: [
  { match: /org\.springframework/i, tech: "spring" },
  { match: /spring-boot/i, tech: "spring" },
  ]},
  { file: "docker-compose.yml", contains: [
    { match: /postgres/i, tech: "postgres" },
    { match: /neo4j/i, tech: "neo4j" },
    { match: /redis/i, tech: "redis" },
    { match: /mysql/i, tech: "mysql" },
    { match: /mongo/i, tech: "mongodb" },
  ]},
];

const GITHUB_LANG_TO_SKILL = {
  "C#": "cs",
  "Java": "java",
  "Python": "python",
  "TypeScript": "ts",
  "JavaScript": "js",
  "HTML": "html",
  "CSS": "css"
};

async function gh(pathname) {
  const res = await fetch(`${API}${pathname}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status} at ${pathname}`);
  return res.json();
}

async function listRepos() {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await gh(`/users/${USERNAME}/repos?per_page=100&page=${page}&type=owner`);

    if (!batch || batch.length === 0) break;

    repos.push(...batch.filter((r) => !r.fork));
    page++;
  }

  return repos;
}

async function listOrganizations() {
  const organizations = [];
  let page = 1;
  while (true) {
    const batch = await gh(`/user/orgs?per_page=100&page=${page}`);
    if (!batch || batch.length === 0) break;
    organizations.push(...batch);
    page++;
  }
  console.log("Organizations:", organizations.map((org) => org.login));
  return organizations;
}

async function listOrganizationRepos(org) {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await gh(`/orgs/${org}/repos?per_page=100&page=${page}&type=all`);
    if (!batch || batch.length === 0) break;
    repos.push(...batch.filter((r) => !r.fork));
    page++;
  }
  return repos;
}

async function listAllRepos() {
  const repos = new Map();

  const userRepos = await listRepos();

  for (const repo of userRepos) {
    repos.set(repo.full_name, repo);
  }

  const organizations = await listOrganizations();

  for (const organization of organizations) {
    try {
      const organizationRepos = await listOrganizationRepos(organization.login);

      for (const repo of organizationRepos) {
        repos.set(repo.full_name, repo);
      }
    } catch (err) {
      console.warn(`Warning: could not scan organization ${organization.login}: ${err.message}`);
    }
  }

  return Array.from(repos.values());
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
      const slug = GITHUB_LANG_TO_SKILL[lang];
      if (slug) found.add(slug);
    }
  }

  if (await getFileContent(owner, name, "Dockerfile")) found.add("docker");

  for (const rule of MANIFEST_RULES) {
    const content = await getFileContent(owner, name, rule.file);
    if (!content) continue;
    for (const c of rule.contains) {
      if (c.match.test(content)) {
        console.log(`${repo.full_name}: detected ${c.tech} from ${rule.file}`);
        found.add(c.tech);
      }
    }
  }

  if (found.size > 0) {
    console.log(`${repo.full_name} detected:`, Array.from(found));
  }

  return found;
}

async function main() {
  const repos = await listAllRepos();
  const allTech = new Set();

  for (const repo of repos) {
    try {
      const tech = await detectTechForRepo(repo);
      tech.forEach((t) => allTech.add(t));
    } catch (err) {
      console.warn(`Warning: could not analyze ${repo.name}: ${err.message}`);
    }
  }

  allTech.add("git");
  allTech.add("github");

  const iconsList = Array.from(allTech).sort().join(",");
  const badge = `\n  <img src="https://skillicons.dev/icons?i=${iconsList}" alt="Tech stack" />\n</p>`;

  let readme = readFileSync(README_PATH, "utf8");

  readme = readme.replace(
    /<!--TECH-STACK:START-->[\s\S]*?<!--TECH-STACK:END-->/,
    `<!--TECH-STACK:START-->
    ${badge}
    <!--TECH-STACK:END-->`
  );

  writeFileSync(README_PATH, readme);
  console.log("Detected tech stack:", iconsList);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
