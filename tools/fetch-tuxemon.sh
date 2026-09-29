#!/bin/sh
# tools/fetch-tuxemon.sh — fetch the Tuxemon source the importer reads.
#
#   sh tools/fetch-tuxemon.sh [dir]     # default: .tuxemon-src
#
# A blobless, sparse checkout of Tuxemon pinned to TUXEMON_COMMIT: maps,
# databases, translations, graphics, sprites, animations, sounds and the
# Python engine (for action/condition semantics). Music, fonts and docs are
# left out (~150 MB). Set TUXEMON_SRC to point the importer elsewhere.
set -eu
TUXEMON_COMMIT=9e6258ff
dir=${1:-.tuxemon-src}
if [ ! -d "$dir/.git" ]; then
  git clone -q --filter=blob:none --no-checkout https://github.com/Tuxemon/Tuxemon.git "$dir"
fi
cd "$dir"
git sparse-checkout init --no-cone
printf '/*\n!/mods/tuxemon/music/\n!/mods/tuxemon/font/\n!/docs/\n' > .git/info/sparse-checkout
git checkout -q "$TUXEMON_COMMIT"
git log --oneline -1
