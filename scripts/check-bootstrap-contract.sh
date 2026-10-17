#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

required=(
  point-cloud-cleaner-spec.md
  README.md
  .gitignore
  AGENTS.md
  docs/GLOSSARY.md
  docs/agents/testing.md
  scripts/check-bootstrap-contract.sh
)

failed=0
fail() { printf 'FAIL: %s\n' "$*" >&2; failed=1; }

for path in "${required[@]}"; do
  [[ -f "$path" ]] || fail "missing required file: $path"
done

if [[ -f .gitignore ]]; then
  probes=(
    fixture.pcd fixture.pcd.zip private.session private.session.zip
    uploads/example outputs/example .env .env.local build/output
    .claude/state .agents/state .scratch/state plans/example *.plan.md
  )
  for probe in "${probes[@]}"; do
    git check-ignore -q -- "$probe" || fail "ignore policy does not ignore: $probe"
  done
  for source_file in point-cloud-cleaner-spec.md README.md docs/GLOSSARY.md; do
    git check-ignore -q -- "$source_file" && fail "source file is ignored: $source_file"
  done
fi

forbidden='(^|/)([^/]+\.pcd|[^/]+\.pcd\.zip|[^/]+\.session|[^/]+\.session\.zip|\.env(\.[^/]*)?|\.claude|\.agents|\.scratch|plans|.*\.plan\.md)(/|$)'
tracked="$(git ls-files)"
if grep -Eqi "$forbidden" <<<"$tracked"; then
  fail "tracked content includes private or planning material"
fi

# Every shell entry point must be executable in the git index (mode 100755);
# the checks image copies files as stored, so a 100644 script fails with
# "permission denied" (CTR-07).
while read -r mode _ _ path; do
  [[ "$mode" == 100755 ]] || fail "not executable in the index (mode $mode): $path"
done < <(git ls-files -s -- 'scripts/*.sh' gr-pcd-visualizer.sh)

if [[ "${1:-}" == "--staged" ]]; then
  staged="$(git diff --cached --name-only | sort)"
  expected="$(printf '%s\n' "${required[@]}" | sort)"
  [[ "$staged" == "$expected" ]] || fail "staged paths are not exactly the bootstrap contract"
elif [[ $# -ne 0 ]]; then
  fail "usage: $0 [--staged]"
fi

(( failed == 0 ))
