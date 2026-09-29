#!/bin/sh
# Cut a semver release: bump manifest Version, commit, tag vX.Y.Z.
# Pushing the tag triggers .github/workflows/release.yml (zip + GitHub Release).
#
# Usage: scripts/release.sh patch|minor|major|X.Y.Z[-pre] [--push]
set -eu
cd "$(dirname "$0")/.."
MANIFEST=dev.countdown.sdPlugin/manifest.json

[ $# -ge 1 ] || { echo "usage: $0 patch|minor|major|X.Y.Z [--push]" >&2; exit 2; }
BUMP="$1"
PUSH="${2:-}"

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing: working tree not clean" >&2; exit 1
fi

CURRENT="$(sed -n 's/.*"Version": *"\([^"]*\)".*/\1/p' "$MANIFEST" | head -1)"
BASE="${CURRENT%%-*}"
MAJOR="${BASE%%.*}"; REST="${BASE#*.}"; MINOR="${REST%%.*}"; PATCH="${REST#*.}"

# From a prerelease, a bump finalises it when possible (npm semantics):
# 1.0.0-rc.1 -> major/minor/patch = 1.0.0; 1.2.0-rc.1 -> minor = 1.2.0.
PRE=""; [ "$CURRENT" != "$BASE" ] && PRE=1
case "$BUMP" in
  major) if [ -n "$PRE" ] && [ "$MINOR" = 0 ] && [ "$PATCH" = 0 ]; then NEXT="$BASE"
         else NEXT="$((MAJOR + 1)).0.0"; fi ;;
  minor) if [ -n "$PRE" ] && [ "$PATCH" = 0 ]; then NEXT="$BASE"
         else NEXT="$MAJOR.$((MINOR + 1)).0"; fi ;;
  patch) if [ -n "$PRE" ]; then NEXT="$BASE"
         else NEXT="$MAJOR.$MINOR.$((PATCH + 1))"; fi ;;
  *)
    if echo "$BUMP" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then NEXT="$BUMP"
    else echo "bad version: $BUMP" >&2; exit 2; fi ;;
esac

# Never go backwards. Compare X.Y.Z; equal X.Y.Z is only allowed when finalising
# a prerelease (1.0.0-rc.1 -> 1.0.0) or moving between prereleases of it.
NB="${NEXT%%-*}"
LOWEST="$(printf '%s\n%s\n' "$BASE" "$NB" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)"
if [ "$NB" != "$BASE" ] && [ "$LOWEST" = "$NB" ]; then
  echo "refusing: $NEXT is lower than current $CURRENT" >&2; exit 1
fi
if [ "$NB" = "$BASE" ] && [ -z "$PRE" ] && [ "$NEXT" != "$CURRENT" ]; then
  echo "refusing: $NEXT is not newer than $CURRENT" >&2; exit 1
fi

if git rev-parse -q --verify "refs/tags/v$NEXT" >/dev/null; then
  echo "tag v$NEXT already exists" >&2; exit 1
fi

if [ "$NEXT" != "$CURRENT" ]; then
  sed -i "s/\"Version\": *\"$CURRENT\"/\"Version\": \"$NEXT\"/" "$MANIFEST"
  git add "$MANIFEST"
  git commit -q -m "Release v$NEXT"
fi
git tag -a "v$NEXT" -m "v$NEXT"
echo "tagged v$NEXT (was $CURRENT)"

if [ "$PUSH" = "--push" ]; then
  git push origin HEAD "v$NEXT"
else
  echo "push with: git push origin HEAD v$NEXT"
fi
