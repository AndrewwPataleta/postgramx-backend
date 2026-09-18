'use strict';

const dotenv = require('dotenv');

function resolveMode() {
    const mode = (process.env.NODE_ENV || 'local').toLowerCase();
    if (mode === 'prod') {
        return 'production';
    }
    return mode;
}

dotenv.config({path: `.env.${resolveMode()}`, override: true});

function printUsage() {
    console.log(
        [
            'Usage:',
            '  node src/scripts/publish-channel-message.js <userId> <channelId> <text>',
            '',
            'Example:',
            '  node src/scripts/publish-channel-message.js 123456789 -1001112223334 "Привет, канал!"',
        ].join('\n'),
    );
}

function parseArgs(argv) {
    const [userId, channelId, ...textParts] = argv;
    const text = textParts.join(' ').trim();

    if (!userId || !channelId || !text) {
        printUsage();
        throw new Error('Missing required arguments: userId, channelId, text.');
    }

    return {userId, channelId, text};
}

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not configured.`);
    }
    return value;
}

async function telegramApi(token, method, payload) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    });

    const body = await response.json();

    if (!response.ok || !body.ok) {
        throw new Error(body.description || `Telegram API ${method} request failed.`);
    }

    return body.result;
}

async function run() {
    const {userId, channelId, text} = parseArgs(process.argv.slice(2));
    const token = requiredEnv('TELEGRAM_BOT_TOKEN');

    const sent = await telegramApi(token, 'sendMessage', {
        chat_id: channelId,
        text,
        parse_mode: 'HTML',
    });

    console.log('Message published successfully.');
    console.log(`userId: ${userId}`);
    console.log(`channelId: ${channelId}`);
    console.log(`messageId: ${sent.message_id}`);
}

run().catch((error) => {
    console.error('Failed to publish message:', error && error.message ? error.message : error);
    process.exitCode = 1;
});
