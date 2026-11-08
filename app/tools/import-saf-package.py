#!/usr/bin/env python3
"""Import the SAF organization package the SAI demo runtime loads as its nominal organization.

Reads the sibling SAF repositories (Apache-2.0) and writes JSON fixtures under
`src/assets/saf-package/` plus the organization **sources** (agents, workflows, conf, artifact
schemas and templates, skills, instructions, verbatim) under `public/saf-package/`, fetched at
startup and seeded into the mocked workspace git as the nominal import (F16-R1, F16-R2). Nothing here interprets the organization: it copies the
declarations SAI needs (agents, workflows with their steps and capability weights, the
model profile catalog) so that the frontend stays agnostic of the organization (affordance
R18) and so that the fixtures can be regenerated when the package changes.

Usage (from `app/`):
    python3 tools/import-saf-package.py [--harness ../../../saf-agentic-harness] \
        [--organization ../../../saf-agentic-organization]

Requires PyYAML. On the POESIS workstation: `.tools/saf-venv/bin/python tools/import-saf-package.py`.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover - environment guard
    sys.stderr.write("PyYAML is required (pip install pyyaml) or use the SAF venv python.\n")
    raise SystemExit(2)

APP_ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = APP_ROOT / "src" / "assets" / "saf-package"
PUBLIC_DIR = APP_ROOT / "public" / "saf-package"

# Folders of the organization repository that form the organization of a workspace (oap#1:
# "agents, skills, instructions, workflows, templates and schemas are workspace artifacts").
SOURCE_FOLDERS = ("agents", "workflows", "conf", "artifacts", "skills", "instructions")
SOURCE_SUFFIXES = (".md", ".yaml", ".yml", ".json", ".txt")

LAYER_BY_FOLDER = {"portfolio": "portfolio", "program": "program", "team": "team"}
ORCHESTRATORS = {"value-management-officer", "release-train-engineer", "scrum-master"}

FRONTMATTER = re.compile(r"^---\n(.*?)\n---", re.S)


def git_describe(repo: Path) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "describe", "--tags", "--always", "--dirty"],
            check=True, capture_output=True, text=True,
        )
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def read_agents(org: Path) -> list[dict]:
    agents = []
    for path in sorted((org / "agents").glob("*.agent.md")):
        text = path.read_text(encoding="utf-8")
        match = FRONTMATTER.search(text)
        meta = yaml.safe_load(match.group(1)) if match else {}
        slug = str(meta.get("name") or path.name.replace(".agent.md", ""))
        description = str(meta.get("description") or "").strip()
        kind = "orchestrator" if slug in ORCHESTRATORS else "specialist"
        agents.append({
            "slug": slug,
            "name": slug.replace("-", " ").title(),
            "kind": kind,
            "description": description,
            "source": f"agents/{path.name}",
        })
    return agents


def read_workflows(org: Path) -> list[dict]:
    workflows = []
    for folder, layer in LAYER_BY_FOLDER.items():
        for path in sorted((org / "workflows" / folder).glob("*.workflow.conf.yaml")):
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            steps = []
            for step in data.get("steps") or []:
                steps.append({
                    "slug": step["slug"],
                    "description": (step.get("description") or "").strip(),
                    "actor": step["actor"],
                    "artifact": step["artifact"],
                    "capabilities": {k: float(v) for k, v in (step.get("capabilities") or {}).items()},
                    "conditions": [
                        {"slug": c.get("slug"), "kind": c.get("kind"), "step": c.get("step")}
                        for c in (step.get("conditions") or [])
                        if c.get("kind") == "precondition" and c.get("step")
                    ],
                    "instructions": _as_list(step.get("instructions")),
                    "skills": _as_list(step.get("skills")),
                })
            workflows.append({
                "slug": data["slug"],
                "layer": layer,
                "description": (data.get("description") or "").strip(),
                "orchestrator": data["orchestrator"],
                "predecessors": _as_list(data.get("predecessors")),
                "steps": steps,
                "source": f"workflows/{folder}/{path.name}",
            })
    return workflows


def read_model_profiles(org: Path) -> list[dict]:
    data = yaml.safe_load((org / "conf" / "model-profiles.conf.yaml").read_text(encoding="utf-8"))
    profiles = []
    for p in data.get("modelProfiles") or []:
        profiles.append({
            "slug": p["slug"],
            "costRank": int(p["costRank"]),
            "description": (p.get("description") or "").strip(),
            "capabilities": {k: float(v) for k, v in (p.get("capabilities") or {}).items()},
        })
    return profiles


def read_item_types(org: Path) -> list[dict]:
    """Trackable item types: artifact schemas that declare a status enum."""
    types = []
    for schema_path in sorted((org / "artifacts").glob("*/*.artifact.schema.json")):
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        meta = schema.get("x-artifact") or {}
        status = (schema.get("properties") or {}).get("status") or {}
        statuses = status.get("enum")
        if not statuses:
            # ADR status is documented as prose, not as an enum, in the current schema.
            desc = str(status.get("description") or "")
            if "|" in desc:
                statuses = [s.strip() for s in desc.split("|")]
        if not statuses:
            continue
        types.append({
            "slug": meta.get("id") or schema_path.stem.split(".")[0],
            "label": (meta.get("id") or "").replace("-", " ").title(),
            "pathPatterns": meta.get("pathPatterns") or [],
            "statuses": statuses,
            "source": f"artifacts/{schema_path.parent.name}/{schema_path.name}",
        })
    return types


def read_workspace_structure(org: Path) -> dict:
    """The workspace structure map (`conf/workspace.conf.yaml`): the tree SAI's explorer follows."""
    data = yaml.safe_load((org / "conf" / "workspace.conf.yaml").read_text(encoding="utf-8")) or {}

    def node(raw: dict) -> dict:
        out = {"slug": str(raw["slug"]), "description": (raw.get("description") or "").strip()}
        if raw.get("artifact"):
            out["artifact"] = str(raw["artifact"])
            out["template"] = str(raw.get("template") or "")
            out["cardinality"] = str(raw.get("cardinality") or "0..*")
        if raw.get("children"):
            out["children"] = [node(c) for c in raw["children"]]
        return out

    return {"source": "conf/workspace.conf.yaml", "nodes": [node(n) for n in data.get("nodes") or []]}


def read_roles(org: Path) -> list[dict]:
    """Roles of the access-control list: who may create, update or delete which artifact."""
    data = yaml.safe_load((org / "conf" / "access-control-list.conf.yaml").read_text(encoding="utf-8")) or {}
    roles = []
    for role in data.get("roles") or []:
        artifacts = sorted({str(p.get("artifact")) for p in role.get("privileges") or [] if p.get("artifact")})
        roles.append({"slug": str(role["slug"]), "artifacts": artifacts})
    return roles


def read_sources(org: Path) -> dict:
    """The organization files verbatim, keyed by their path relative to the organization root."""
    files: dict[str, str] = {}
    for folder in SOURCE_FOLDERS:
        for path in sorted((org / folder).rglob("*")):
            if path.is_file() and path.suffix in SOURCE_SUFFIXES:
                files[path.relative_to(org).as_posix()] = path.read_text(encoding="utf-8")
    return {
        "root": "organization",
        "package": "saf-agentic-organization",
        "version": git_describe(org),
        "folders": list(SOURCE_FOLDERS),
        "files": files,
    }


def _as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return [str(v) for v in value]


def _count_nodes(nodes: list[dict]) -> int:
    return sum(1 + _count_nodes(n.get("children") or []) for n in nodes)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--harness", default=str(APP_ROOT.parents[2] / "saf-agentic-harness"))
    parser.add_argument("--organization", default=str(APP_ROOT.parents[2] / "saf-agentic-organization"))
    args = parser.parse_args()
    harness = Path(args.harness).resolve()
    org = Path(args.organization).resolve()
    if not (org / "workflows").is_dir():
        sys.stderr.write(f"organization not found at {org}\n")
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    agents = read_agents(org)
    workflows = read_workflows(org)
    profiles = read_model_profiles(org)
    item_types = read_item_types(org)
    structure = read_workspace_structure(org)
    roles = read_roles(org)
    package = {
        "id": "saf-agentic-organization",
        "name": "Poesis SAFe Agentic Organization",
        "license": "Apache-2.0",
        "organizationVersion": git_describe(org),
        "harnessVersion": git_describe(harness),
        "sourceRepositories": {
            "organization": "https://github.com/poesis-cloud/saf-agentic-organization",
            "harness": "https://github.com/poesis-cloud/saf-agentic-harness",
        },
        "counts": {
            "agents": len(agents),
            "workflows": len(workflows),
            "modelProfiles": len(profiles),
            "itemTypes": len(item_types),
            "structureNodes": _count_nodes(structure["nodes"]),
            "roles": len(roles),
        },
    }
    (OUT_DIR / "package.json").write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    (OUT_DIR / "agents.json").write_text(json.dumps(agents, indent=2) + "\n", encoding="utf-8")
    (OUT_DIR / "workflows.json").write_text(json.dumps(workflows, indent=2) + "\n", encoding="utf-8")
    (OUT_DIR / "model-profiles.json").write_text(json.dumps(profiles, indent=2) + "\n", encoding="utf-8")
    (OUT_DIR / "item-types.json").write_text(json.dumps(item_types, indent=2) + "\n", encoding="utf-8")
    (OUT_DIR / "workspace-structure.json").write_text(json.dumps(structure, indent=2) + "\n", encoding="utf-8")
    (OUT_DIR / "roles.json").write_text(json.dumps(roles, indent=2) + "\n", encoding="utf-8")
    sources = read_sources(org)
    package["counts"]["sourceFiles"] = len(sources["files"])
    (OUT_DIR / "package.json").write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DIR / "organization-sources.json").write_text(
        json.dumps(sources, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print(json.dumps(package["counts"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
