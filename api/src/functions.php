<?php
declare(strict_types=1);

namespace Cas;

/** Current time in milliseconds (matches JavaScript Date.now()). */
function now(): int
{
    return (int) floor(microtime(true) * 1000);
}
