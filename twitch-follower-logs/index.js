require('dotenv').config();

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');
const followers = JSON.parse(fs.readFileSync('followers.json', 'utf8'));

const REQUIRED_ENV_VARS = ['GRAPHQL_OAUTH', 'GRAPHQL_INTEGRITY', 'GRAPHQL_DEVICEID'];

REQUIRED_ENV_VARS.forEach((envVar) => {
    if (!process.env[envVar]) {
        console.error(`Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
});

const printMessage = (message) => console.log(new Date().toLocaleTimeString(), message);
const numberWithCommas = (x) => x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const ensureDirectoryExists = (dir) => !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });
const requestTemplate = (body) => ({
    method: 'POST',
    headers: {
        'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Authorization': `OAuth ${process.env.GRAPHQL_OAUTH}`,
        'Content-Type': 'application/json',
        'Client-Integrity': process.env.GRAPHQL_INTEGRITY,
        'X-Device-Id': process.env.GRAPHQL_DEVICEID,
    },
    body: JSON.stringify(body),
});

async function getMessages(username, userId) {
    const chatDir = 'chat_data';
    ensureDirectoryExists(chatDir);
    const filePath = path.join(chatDir, `${username}.json`);

    if (fs.existsSync(filePath)) {
        printMessage(`Messages already fetched for ${username}, skipping...`);
        return;
    }

    if (!userId) {
        printMessage(`Could not locate user ${username} on Twitch. Skipping...`);
        fs.writeFileSync(filePath, JSON.stringify({ username, userId, messages: [] }, null, 2));
        return;
    }

    printMessage(`Fetching messages for ${username} (ID: ${userId})`);

    const messages = [];
    let cursor = null;

    while (true) {
        const response = await fetch('https://gql.twitch.tv/gql', requestTemplate([
            {
                operationName: 'ViewerCardModLogsMessagesBySender',
                variables: { senderID: userId, channelID: '56395702', cursor },
                extensions: { persistedQuery: { version: 1, sha256Hash: '53962d07438ec66900c0265d3e9ec99c4124067ac3a9c718bc29b0b047d1e89c' } },
            },
        ]));

        if (!response.ok) {
            printMessage(`Failed to fetch messages for ${username}: HTTP ${response.status}`);
            return;
        }

        const payload = await response.json();
        const data = payload[0]?.data?.viewerCardModLogs?.messages;

        if (payload[0]?.errors?.some(e => e.message === "failed integrity check")) {
            printMessage(`Integrity check failed. Stopping further processing.`);
            process.exit(1);
        }        

        if (!data || !data.edges) {
            printMessage(`No valid message data received for ${username}. Full payload:`);
            console.log(JSON.stringify(payload, null, 2));
            break;
        }

        if (data.edges.length === 0) {
            printMessage(`No messages found for ${username}`);
            break;
        }

        messages.push(...data.edges);

        if (messages.length > 0) {
            printMessage(`Fetched ${numberWithCommas(messages.length)} messages so far for ${username}...`);
        }

        if (!data.pageInfo?.hasNextPage) {
            break;
        }

        cursor = data.edges[data.edges.length - 1].cursor;
    }

    fs.writeFileSync(filePath, JSON.stringify({ username, userId, messages: messages.map(m => ({
            content: m.node.content?.text || "",
            isDeleted: m.node.isDeleted || false,
            displayName: m.node.sender?.displayName || "",
            senderId: m.node.sender?.id || "",
            sentAt: m.node.sentAt || ""
        })) }, null, 2));

    if (messages.length > 0) {
        printMessage(`Chat archive saved for ${username} (${messages.length} messages)`);
    }

    return messages;
}

async function processFollowers() {
    const totalUsers = followers.length;
    let processed = 0;

    for (const user of followers) {
        const messages = await getMessages(user.userName, String(user.userID)) ?? [];

        processed++;

        if (messages.length > 0) {
            printMessage(`Processed ${processed}/${totalUsers}`);
        }
    }

    printMessage('All users processed. Exiting...');
}

processFollowers();
