<?php
declare(strict_types=1);

namespace Cas\Http;

final class HttpError extends \RuntimeException
{
    /** @param array<string,string> $fields */
    public function __construct(public readonly int $status, public readonly string $errorCode, string $message, public readonly array $fields = [])
    {
        parent::__construct($message);
    }

    public static function validation(array $fields): self
    {
        return new self(422, 'validation_failed', 'Please check the highlighted fields.', $fields);
    }

    public static function notFound(string $what = 'Resource'): self
    {
        return new self(404, 'not_found', "$what not found.");
    }

    public static function unauthorized(): self
    {
        return new self(401, 'unauthenticated', 'Please sign in.');
    }
}
