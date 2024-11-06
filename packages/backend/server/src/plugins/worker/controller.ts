import {
  Controller,
  Get,
  Logger,
  Options,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { HTMLRewriter } from 'htmlrewriter';

import { BadRequest, Config, URLHelper } from '../../fundamentals';
import type { LinkPreviewRequest, LinkPreviewResponse } from './types';
import {
  appendUrl,
  cloneHeader,
  fixUrl,
  getCorsHeaders,
  isOriginAllowed,
  isRefererAllowed,
  OriginRules,
  parseJson,
  reduceUrls,
} from './utils';

@Controller('/api/worker')
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);
  private readonly allowedOrigin: OriginRules;

  constructor(
    config: Config,
    private readonly url: URLHelper
  ) {
    this.allowedOrigin = [
      ...config.plugins.worker.allowedOrigin
        .map(u => fixUrl(u)?.origin as string)
        .filter(v => !!v),
      url.origin,
    ];
  }

  @Get('/image-proxy')
  async imageProxy(@Req() req: Request, @Res() resp: Response) {
    const origin = req.headers.origin ?? '';
    const referer = req.headers.referer;
    if (
      (origin && !isOriginAllowed(origin, this.allowedOrigin)) ||
      (referer && !isRefererAllowed(referer, this.allowedOrigin))
    ) {
      this.logger.error('Invalid Origin', 'ERROR', { origin, referer });
      throw new BadRequest('Invalid header');
    }
    const url = new URL(req.url, this.url.baseUrl);
    const imageURL = url.searchParams.get('url');
    if (!imageURL) {
      throw new BadRequest('Missing "url" parameter');
    }

    const targetURL = fixUrl(imageURL);
    if (!targetURL) {
      this.logger.error(`Invalid URL: ${url}`);
      throw new BadRequest(`Invalid URL`);
    }

    const response = await fetch(
      new Request(targetURL.toString(), {
        method: 'GET',
        headers: cloneHeader(req.headers),
      })
    );
    if (response.ok) {
      const contentType = response.headers.get('Content-Type');
      const contentDisposition = response.headers.get('Content-Disposition');
      if (contentType?.startsWith('image/')) {
        return resp
          .status(200)
          .header({
            'Access-Control-Allow-Origin': origin ?? 'null',
            Vary: 'Origin',
            'Access-Control-Allow-Methods': 'GET',
            'Content-Type': contentType,
            'Content-Disposition': contentDisposition,
          })
          .send(Buffer.from(await response.arrayBuffer()));
      } else {
        throw new BadRequest('Invalid content type');
      }
    } else {
      this.logger.error('Failed to fetch image', {
        origin,
        url: imageURL,
        status: resp.status,
      });
      throw new BadRequest('Failed to fetch image');
    }
  }

  @Options('/link-preview')
  linkPreviewOption(@Req() request: Request, @Res() resp: Response) {
    const origin = request.headers.origin;
    return resp
      .status(200)
      .header({
        ...getCorsHeaders(origin),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      .send();
  }

  @Post('/link-preview')
  async linkPreview(
    @Req() request: Request,
    @Res() resp: Response
  ): Promise<Response> {
    const origin = request.headers.origin;
    const referer = request.headers.referer;
    if (
      (origin && !isOriginAllowed(origin, this.allowedOrigin)) ||
      (referer && !isRefererAllowed(referer, this.allowedOrigin))
    ) {
      this.logger.error('Invalid Origin', { origin, referer });
      throw new BadRequest('Invalid header');
    }

    this.logger.debug('Received request', { origin, method: request.method });

    const targetBody = parseJson<LinkPreviewRequest>(request.body);
    const targetURL = fixUrl(targetBody?.url);
    // not allow same site preview
    if (!targetURL || isOriginAllowed(targetURL.origin, this.allowedOrigin)) {
      this.logger.error('Invalid URL', { origin, url: targetBody?.url });
      throw new BadRequest('Invalid URL');
    }

    this.logger.debug('Processing request', { origin, url: targetURL });

    try {
      const response = await fetch(targetURL, {
        headers: cloneHeader(request.headers),
      });
      this.logger.error('Fetched URL', {
        origin,
        url: targetURL,
        status: response.status,
      });

      const res: LinkPreviewResponse = {
        url: response.url,
        images: [],
        videos: [],
        favicons: [],
      };
      const baseUrl = new URL(request.url, this.url.baseUrl).toString();

      if (response.body) {
        const rewriter = new HTMLRewriter()
          .on('meta', {
            element(element) {
              const property =
                element.getAttribute('property') ??
                element.getAttribute('name');
              const content = element.getAttribute('content');
              if (property && content) {
                switch (property.toLowerCase()) {
                  case 'og:title':
                    res.title = content;
                    break;
                  case 'og:site_name':
                    res.siteName = content;
                    break;
                  case 'og:description':
                    res.description = content;
                    break;
                  case 'og:image':
                    appendUrl(content, res.images);
                    break;
                  case 'og:video':
                    appendUrl(content, res.videos);
                    break;
                  case 'og:type':
                    res.mediaType = content;
                    break;
                  case 'description':
                    if (!res.description) {
                      res.description = content;
                    }
                }
              }
            },
          })
          .on('link', {
            element(element) {
              if (element.getAttribute('rel')?.toLowerCase().includes('icon')) {
                appendUrl(element.getAttribute('href'), res.favicons);
              }
            },
          })
          .on('title', {
            text(text) {
              if (!res.title) {
                res.title = text.text;
              }
            },
          })
          .on('img', {
            element(element) {
              appendUrl(element.getAttribute('src'), res.images);
            },
          })
          .on('video', {
            element(element) {
              appendUrl(element.getAttribute('src'), res.videos);
            },
          });

        await rewriter.transform(response).text();

        res.images = await reduceUrls(baseUrl, res.images);

        this.logger.error('Processed response with HTMLRewriter', {
          origin,
          url: response.url,
        });
      }

      // fix favicon
      {
        // head default path of favicon
        const faviconUrl = new URL('/favicon.ico', response.url);
        const faviconResponse = await fetch(faviconUrl, { method: 'HEAD' });
        if (faviconResponse.ok) {
          appendUrl(faviconUrl.toString(), res.favicons);
        }

        res.favicons = await reduceUrls(baseUrl, res.favicons);
      }

      const json = JSON.stringify(res);
      this.logger.debug('Sending response', {
        origin,
        url: res.url,
        responseSize: json.length,
      });

      return resp
        .status(200)
        .header({
          'content-type': 'application/json;charset=UTF-8',
          ...getCorsHeaders(origin),
        })
        .send(json);
    } catch (error) {
      this.logger.error('Error fetching URL', {
        origin,
        url: targetURL,
        error,
      });
      throw new BadRequest('Error fetching URL');
    }
  }
}
