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
            '  node src/scripts/edit-channel-publication.js <userId> <channelId> <publicationId> <text>',
            '',
            'Example:',
            '  node src/scripts/edit-channel-publication.js 987654321 -1001112223334 57 "Обновленный текст"',
        ].join('\n'),
    );
}

function parsePublicationId(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid publicationId: ${value}`);
    }
    return parsed;
}

function parseArgs(argv) {
    const [userId, channelId, publicationIdRaw, ...textParts] = argv;
    const text = textParts.join(' ').trim();

    if (!userId || !channelId || !publicationIdRaw || !text) {
        printUsage();
        throw new Error('Missing required arguments: userId, channelId, publicationId, text.');
    }

    return {
        userId,
        channelId,
        publicationId: parsePublicationId(publicationIdRaw),
        text,
    };
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
    const {userId, channelId, publicationId, text} = parseArgs(process.argv.slice(2));
    const token = requiredEnv('TELEGRAM_BOT_TOKEN');

    await telegramApi(token, 'editMessageText', {
        chat_id: channelId,
        message_id: publicationId,
        text,
        parse_mode: 'HTML',
    });

    console.log('Publication updated successfully.');
    console.log(`userId: ${userId}`);
    console.log(`channelId: ${channelId}`);
    console.log(`publicationId: ${publicationId}`);
}

run().catch((error) => {
    console.error('Failed to edit publication:', error && error.message ? error.message : error);
    process.exitCode = 1;
});
