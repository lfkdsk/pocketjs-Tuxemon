#!/bin/sh
# tools/fetch-tuxemon.sh — fetch the Tuxemon source the importer reads.
#
#   sh tools/fetch-tuxemon.sh [dir]     # default: .tuxemon-src
#
# A blobless, sparse checkout of Tuxemon pinned to TUXEMON_COMMIT: maps,
# databases, translations, graphics, sprites, animations, sounds and the
# Python engine (for action/condition semantics). Fonts and docs are left
# out. Music is excluded except for the mainline tracks the importer maps
# (GM0 §1.1); everything else under music/ stays out (~140 MB). Set
# TUXEMON_SRC to point the importer elsewhere.
set -eu
TUXEMON_COMMIT=9e6258ff
dir=${1:-.tuxemon-src}
if [ ! -d "$dir/.git" ]; then
  git clone -q --filter=blob:none --no-checkout https://github.com/Tuxemon/Tuxemon.git "$dir"
fi
cd "$dir"
git sparse-checkout init --no-cone
# Mainline music (GM0 §1.1): exclude the whole music tree, then re-include
# the eight tracks the mainline journeys play. Keep this list in sync with
# tools/transcode-audio.ts.
cat > .git/info/sparse-checkout <<'EOF'
/*
!/mods/tuxemon/music/**
/mods/tuxemon/music/All of Us.ogg
/mods/tuxemon/music/JRPG_royalCourt_loop.ogg
/mods/tuxemon/music/JRPG_town_loop.ogg
/mods/tuxemon/music/peasant_kingdom.ogg
/mods/tuxemon/music/back34.mp3
/mods/tuxemon/music/Jester Theme.mp3
/mods/tuxemon/music/JRPG-OSTR2/
/mods/tuxemon/music/JRPG-OSTR2/10 - The Empire.ogg
/mods/tuxemon/music/JRPG-OSTR2/07 - Town.ogg
!/mods/tuxemon/font/
!/docs/
EOF
git checkout -q "$TUXEMON_COMMIT"
git log --oneline -1
