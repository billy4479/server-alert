import * as crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Telegram } from 'telegraf';
// eslint-disable-next-line object-curly-newline
import { getEnv, getDB, getRawBody, Row } from './_utils.js';

export default async (request: VercelRequest, response: VercelResponse) => {
  // Verify webhook: https://gist.github.com/stigok/57d075c1cf2a609cb758898c0b202428
  {
    const sigHeaderName = 'x-hub-signature-256';
    const sigHashAlg = 'sha256';

    const rawBody = await getRawBody(request);
    const header = request.headers[sigHeaderName];
    const sig = Buffer.from(header as string, 'utf8');
    const hmac = crypto.createHmac(sigHashAlg, getEnv('GH_HOOK_SECRET'));
    const digest = Buffer.from(
      `${sigHashAlg}=${hmac.update(rawBody).digest('hex')}`,
      'utf8',
    );
    if (sig.length !== digest.length || !crypto.timingSafeEqual(digest, sig)) {
      return response.status(401).send(null);
    }
  }

  const body = await request.body;
  const { commits } = body;
  const { message } = commits[commits.length - 1];
  const repoName: string = body.repository.full_name;
  const username: string = body.pusher.name;

  console.log({ github: { repoName, username, message } });

  // TODO: refine this
  const isOpen = message.includes('Acquiring lock');

  const connection = getDB();

  if (isOpen) {
    await connection.execute({
      sql: 'UPDATE ServerStatus SET IsOpen = 1, LockHolder = ? WHERE Name = ?',
      args: [username, repoName],
    });
  } else {
    await connection.execute({
      sql: 'UPDATE ServerStatus SET IsOpen = 0, LockHolder = NULL WHERE Name = ?',
      args: [repoName],
    });
  }

  const result = await connection.execute({
    sql: 'SELECT ChannelID FROM ServerStatus WHERE Name = ?',
    args: [repoName],
  });

  if (result.rows.length !== 0) {
    const channelID: string | null = (result.rows[0] as Row).ChannelID;
    if (channelID) {
      console.log({ nofication: { channelID } });

      const bot = new Telegram(getEnv('TG_TOKEN'));
      await bot.sendMessage(
        channelID,
        `\`${repoName}\` was ${
          isOpen ? `*OPENED* by _${username}_` : '*CLOSED*'
        }`,
        {
          parse_mode: 'MarkdownV2',
        },
      );
    }
  }

  return response.status(200).send(null);
};
