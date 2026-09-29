"""Boot the real Tuxemon DB headlessly with a shared mulberry32 stream.

The stdlib random functions must be patched before importing Tuxemon because
EnqueuedAction captures random.random as its dataclass default factory.
"""

from __future__ import annotations

import bisect
import logging
import os
import random as _random
import sys

MASK = 0xFFFFFFFF


class Mulberry32:
    """Bit-identical to battle/core.ts and Pocket RPG Kit's interpreter."""

    def __init__(self, seed: int = 1) -> None:
        self.seed(seed)

    def seed(self, seed: int) -> None:
        self.a = seed & MASK
        self.draws = 0

    def next_u32(self) -> int:
        self.a = (self.a + 0x6D2B79F5) & MASK
        value = self.a
        value = ((value ^ (value >> 15)) * (value | 1)) & MASK
        value = (
            (value + (((value ^ (value >> 7)) * (value | 61)) & MASK))
            & MASK
        ) ^ value
        return (value ^ (value >> 14)) & MASK

    def random(self) -> float:
        self.draws += 1
        return self.next_u32() / 4294967296


RNG = Mulberry32(1)


def _choice(sequence):
    return sequence[int(RNG.random() * len(sequence))]


def _randint(start, end):
    return start + int(RNG.random() * (end - start + 1))


def _uniform(start, end):
    return start + (end - start) * RNG.random()


def _choices(population, weights=None, *, cum_weights=None, k=1):
    size = len(population)
    if cum_weights is None:
        if weights is None:
            return [population[int(RNG.random() * size)] for _ in range(k)]
        cum_weights = []
        accumulated = 0.0
        for weight in weights:
            accumulated += weight
            cum_weights.append(accumulated)
    total = cum_weights[-1]
    return [
        population[
            bisect.bisect(cum_weights, RNG.random() * total, 0, size - 1)
        ]
        for _ in range(k)
    ]


def _shuffle(values):
    for index in reversed(range(1, len(values))):
        selected = int(RNG.random() * (index + 1))
        values[index], values[selected] = values[selected], values[index]


def _sample(population, count):
    pool = list(population)
    result = []
    for _ in range(count):
        selected = int(RNG.random() * len(pool))
        result.append(pool.pop(selected))
    return result


_random.random = RNG.random
_random.choice = _choice
_random.randint = _randint
_random.uniform = _uniform
_random.choices = _choices
_random.shuffle = _shuffle
_random.sample = _sample

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
TUXEMON_SRC = os.environ.get("TUXEMON_SRC", "/var/tmp/tuxemon-src")
sys.path.insert(0, TUXEMON_SRC)
os.chdir(TUXEMON_SRC)
logging.disable(logging.CRITICAL)

from tuxemon.database.runtime import db  # noqa: E402

db.load(validate=False)

from tuxemon.core.asset import init_assets  # noqa: E402

init_assets()
