import { Controller, Logger } from '@nestjs/common';

import { Config } from '../../fundamentals';

@Controller('/api/worker')
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);
  private readonly allowedOrigin: OriginRules;

  constructor(private readonly url: URLHelper) {
    this.allowedOrigin = url.origin;
  }

  @Get('/image-proxy')
  async imageProxy(@Req() req: Request, @Res() resp: Response) {
    const origin = req.headers.origin ?? '';
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
}
