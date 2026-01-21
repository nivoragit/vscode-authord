import * as http from 'http';
import * as https from 'https';
import { getLogger } from '../LoggerService';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const logger = getLogger();

export interface JsonRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function requestJson(options: JsonRequestOptions): Promise<any> {
  const {
    url,
    method = 'POST',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
  } = options;

  let target: URL;
  try {
    target = new URL(url);
  } catch (error: any) {
    logger.error('HTTP request URL is invalid.', {
      url,
      error: error?.message || String(error),
    });
    throw new Error(`Invalid URL: ${error?.message || String(error)}`);
  }

  const isHttp = target.protocol === 'http:';
  const isHttps = target.protocol === 'https:';
  if (!isHttp && !isHttps) {
    logger.error('HTTP request URL uses an unsupported protocol.', { url });
    throw new Error('URL must use http or https.');
  }

  const payload = body === undefined ? undefined : JSON.stringify(body);
  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };

  if (payload !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    requestHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
  }

  const transport = isHttp ? http : https;

  logger.debug('HTTP request started.', { method, url });

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method,
        hostname: target.hostname,
        port: target.port ? Number(target.port) : undefined,
        path: `${target.pathname}${target.search}`,
        headers: requestHeaders,
      },
      (res) => {
        res.setEncoding('utf8');

        let data = '';
        let bytes = 0;

        res.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk, 'utf8');
          if (bytes > maxBytes) {
            req.destroy(new Error('Response too large.'));
            return;
          }
          data += chunk;
        });

        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            const statusMessage = res.statusMessage ? ` ${res.statusMessage}` : '';
            const detail = data ? ` ${data.slice(0, 500)}` : '';
            logger.error('HTTP request failed.', {
              url,
              method,
              status,
              statusMessage: res.statusMessage,
              detail: data ? data.slice(0, 500) : undefined,
            });
            reject(new Error(`Request failed (${status}${statusMessage}).${detail}`));
            return;
          }
          if (!data.trim()) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            logger.error('HTTP response was not valid JSON.', { url, method, status });
            reject(new Error('Response was not valid JSON.'));
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      logger.error('HTTP request timed out.', { url, method, timeoutMs });
      req.destroy(new Error('Request timed out.'));
    });

    req.on('error', (error) => {
      logger.error('HTTP request encountered an error.', {
        url,
        method,
        error: error?.message || String(error),
      });
      reject(error);
    });

    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}
