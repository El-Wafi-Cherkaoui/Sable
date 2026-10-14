#!/bin/sh
# Records assets/demo.gif with vhs in Docker, from a fake "shop" workspace.
# Run from the repo root after `npm run build`: sh scripts/demo/record.sh
set -e
repo=$(pwd)
work=$(mktemp -d)
mkdir -p "$work/demo/shop/scripts" "$work/demo/blog" "$work/demo/infra" "$work/demo/config/sable-nodejs" "$work/out"
cp scripts/demo/fake.js "$work/demo/shop/scripts/"
cp scripts/demo/workspaces.json scripts/demo/settings.json "$work/demo/config/sable-nodejs/"
docker build -q -t sable-vhs scripts/demo
docker run --rm -v "$work/demo:/demo" -v "$work/out:/out" -v "$repo/scripts/demo/demo.tape:/demo.tape:ro" -v "$repo:/sable:ro" sable-vhs /demo.tape
cp "$work/out/demo.gif" assets/demo.gif
rm -rf "$work"
echo "Wrote assets/demo.gif"
