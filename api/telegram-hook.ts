import { Telegram, deunionize } from 'telegraf';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Update } from 'telegraf/types';
import { Client } from '@libsql/client';
import * as crypto from 'crypto';
import { Row, getDB, getEnv } from './_utils.js';

async function sendHelpMessage(error: string, bot: Telegram, to: number) {
  await bot.sendMessage(to, `Error: ${error}. Type /help for more information`);
}

async function serverStatus(
  bot: Telegram,
  to: number,
  db: Client,
  serverName: string,
) {
  const result = await db.execute({
    sql: 'SELECT IsOpen, LockHolder FROM ServerStatus WHERE Name = ?',
    args: [serverName],
  });
  if (result.rows.length !== 1) {
    if (result.rows.length === 0) {
      sendHelpMessage(`server with name "${serverName}" not found`, bot, to);
    }
    sendHelpMessage(
      `rows length is ${result.rows.length} instead of 1`,
      bot,
      to,
    );
  }
  const data: Row = result.rows[0];
  const isOpen = (data.IsOpen as number) === 1;
  const lockHolder: string | null = data.LockHolder;

  await bot.sendMessage(
    to,
    `\`${serverName}\` is currently ${
      isOpen ? `*OPEN* by _${lockHolder}_` : '*CLOSE*'
    }`,
    {
      parse_mode: 'MarkdownV2',
    },
  );
}
async function processUpdates(request: VercelRequest) {
  const update = deunionize((await request.body) as Update);

  const bot = new Telegram(getEnv('TG_TOKEN'));
  if (update.message) {
    const message = deunionize(update.message);
    if (message.text) {
      const msg = message.text;

      if (msg[0] === '/') {
        console.log({ telegram: update });

        const splits = msg.split(' ', 2);
        const command = splits[0].slice(1).split('@', 1)[0].trim();
        const args: string | undefined = splits[1];

        const db = getDB();

        switch (command) {
          case 'status': {
            if (args) {
              await serverStatus(bot, message.chat.id, db, args.trim());
              return;
            }

            const result = await db.execute({
              sql: 'SELECT Name FROM ServerStatus WHERE ChannelID = ?',
              args: [message.chat.id],
            });

            if (result.rows.length === 0) {
              await sendHelpMessage(
                'no server specified',
                bot,
                message.chat.id,
              );
              return;
            }

            const promises: Promise<void>[] = [];
            for (let i = 0; i < result.rows.length; i++) {
              const serverName: string = (result.rows[i] as Row).Name;
              promises.push(serverStatus(bot, message.chat.id, db, serverName));
            }
            await Promise.all(promises);

            break;
          }

          case 'subscribe': {
            if (!args) {
              await sendHelpMessage(
                'no server specified',
                bot,
                message.chat.id,
              );
              return;
            }

            await db.execute({
              sql: 'UPDATE ServerStatus SET ChannelID = ? WHERE Name = ?',
              args: [message.chat.id, args.trim()],
            });

            await bot.sendMessage(
              message.chat.id,
              `Subscribed to \`${args}\``,
              { parse_mode: 'MarkdownV2' },
            );
            break;
          }

          case 'help': {
            await bot.sendMessage(
              message.chat.id,
              'Available commands are:\n\n- /status <server-name>\n- /help',
            );
            break;
          }

          default:
            await sendHelpMessage(
              'command does not exist',
              bot,
              message.chat.id,
            );
            break;
        }
      }
    }
  }
}

export default async (request: VercelRequest, response: VercelResponse) => {
  const header = request.headers['x-telegram-bot-api-secret-token'] as string;
  const hookSecret = getEnv('TG_HOOK_SECRET');
  if (
    !header ||
    header.length !== hookSecret.length ||
    !crypto.timingSafeEqual(
      Buffer.from(header),
      Buffer.from(getEnv('TG_HOOK_SECRET')),
    )
  ) {
    return response.status(401).send('unauthorized');
  }
  await processUpdates(request).catch(console.error);
  return response.status(200).send(null);
};
