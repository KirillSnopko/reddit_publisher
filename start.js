// NodeJS Dependencies
const fs = require('fs');
const { SOURCE, lastIndexDir } = require('./system.js');
const { useReddit } = require( './reddit.js');
const { useVk } = require( './vk.js');
const configChannel = require('./channels_config.json');

startScript();

async function startScript() {
    console.log('Start......');
    if (configChannel == null || configChannel.length == 0) {
        console.log('channel config is empty');
        return;
    }

    for (const channel of configChannel) {
        if (channel.dailyPosts <= 0) {
            console.log('Skip channel ' + channel.channel_name);
            continue;
        }
    
        if (!fs.existsSync(lastIndexDir)) {
            fs.mkdirSync(lastIndexDir, { recursive: true });
        }
    
        if (channel.source == SOURCE.REDDIT) {
            await useReddit(channel);
        } else if (channel.source == SOURCE.VK) {
            await useVk(channel);
        }
    }
}
