<?php
declare(strict_types=1);

namespace Cas;

/**
 * Transactional e-mail.
 * Drivers: "log" (writes .eml files to storage/mail — dev), "mail" (PHP mail()), "smtp".
 */
final class Mailer
{
    public function __construct(private Config $config)
    {
    }

    public function send(string $to, string $subject, string $text): bool
    {
        $fromAddr = (string) $this->config->get('mail.from');
        $fromName = (string) $this->config->get('mail.from_name');
        $headers = [
            'From' => sprintf('%s <%s>', $this->encodeHeader($fromName), $fromAddr),
            'MIME-Version' => '1.0',
            'Content-Type' => 'text/plain; charset=UTF-8',
            'Content-Transfer-Encoding' => 'quoted-printable',
            'Date' => date('r'),
            'Message-ID' => sprintf('<%s@%s>', Support::id(), preg_replace('/^.*@/', '', $fromAddr)),
        ];
        $body = quoted_printable_encode(str_replace("\n", "\r\n", str_replace("\r\n", "\n", $text)));
        $encSubject = $this->encodeHeader($subject);

        try {
            return match ($this->config->get('mail.driver')) {
                'smtp' => $this->smtp($fromAddr, $to, $encSubject, $headers, $body),
                'mail' => mail($to, $encSubject, $body, $this->headerLines($headers), '-f' . $fromAddr),
                default => $this->log($to, $encSubject, $headers, $text),
            };
        } catch (\Throwable $e) {
            error_log('[mailer] ' . $e->getMessage());
            return false;
        }
    }

    private function encodeHeader(string $s): string
    {
        return preg_match('/[^\x20-\x7E]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
    }

    private function headerLines(array $headers): string
    {
        return implode("\r\n", array_map(fn ($k, $v) => "$k: $v", array_keys($headers), $headers));
    }

    private function log(string $to, string $subject, array $headers, string $text): bool
    {
        $file = $this->config->storage('mail') . '/' . date('Ymd-His') . '-' . Support::id() . '.eml';
        return file_put_contents($file, "To: $to\r\nSubject: $subject\r\n" . $this->headerLines($headers) . "\r\n\r\n" . $text) !== false;
    }

    private function smtp(string $from, string $to, string $subject, array $headers, string $body): bool
    {
        $host = (string) $this->config->get('mail.smtp.host');
        $port = (int) $this->config->get('mail.smtp.port');
        $secure = (string) $this->config->get('mail.smtp.secure');
        $timeout = (int) $this->config->get('mail.smtp.timeout');
        $remote = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
        $fp = stream_socket_client($remote, $errno, $errstr, $timeout);
        if (!$fp) {
            throw new \RuntimeException("SMTP connect failed: $errstr");
        }
        stream_set_timeout($fp, $timeout);
        $read = static function () use ($fp): string {
            $data = '';
            while (($line = fgets($fp, 515)) !== false) {
                $data .= $line;
                if (strlen($line) < 4 || $line[3] === ' ') {
                    break;
                }
            }
            return $data;
        };
        $cmd = static function (string $c, array $ok) use ($fp, $read): string {
            fwrite($fp, $c . "\r\n");
            $r = $read();
            if (!in_array((int) substr($r, 0, 3), $ok, true)) {
                throw new \RuntimeException('SMTP error after "' . preg_replace('/^(AUTH|PASS).*/', '$1 ***', $c) . '": ' . trim($r));
            }
            return $r;
        };
        $read();
        $ehlo = 'EHLO ' . (gethostname() ?: 'localhost');
        $cmd($ehlo, [250]);
        if ($secure === 'tls') {
            $cmd('STARTTLS', [220]);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                throw new \RuntimeException('SMTP STARTTLS failed');
            }
            $cmd($ehlo, [250]);
        }
        $user = (string) $this->config->get('mail.smtp.user');
        if ($user !== '') {
            $cmd('AUTH LOGIN', [334]);
            $cmd(base64_encode($user), [334]);
            $cmd(base64_encode((string) $this->config->get('mail.smtp.password')), [235]);
        }
        $cmd("MAIL FROM:<$from>", [250]);
        $cmd("RCPT TO:<$to>", [250, 251]);
        $cmd('DATA', [354]);
        $data = "To: $to\r\nSubject: $subject\r\n" . $this->headerLines($headers) . "\r\n\r\n" . preg_replace('/^\./m', '..', $body);
        $cmd($data . "\r\n.", [250]);
        fwrite($fp, "QUIT\r\n");
        fclose($fp);
        return true;
    }
}
