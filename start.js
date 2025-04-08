// NodeJS Dependencies
const fs = require('fs');
const { SOURCE, lastIndexDir } = require('./system.js');
const { useReddit } = require('./reddit.js');
const { useVk } = require('./vk.js');
//const configChannel = require('./channels_config.json');

async function startScript(configChannel) {
    console.log('-----------------------------------> START <-----------------------------------');
    if (configChannel == null || configChannel.length == 0) {
        console.log('channel config is empty');
        return;
    }

    if (!fs.existsSync(lastIndexDir)) {
        fs.mkdirSync(lastIndexDir, { recursive: true });
    }

    for (const channel of configChannel) {
        console.log(`\n-----------------------------------> СHANNEL: ${channel.channel_name} | posts: ${channel.dailyPosts} <-----------------------------------`);

        var sources = channel.sources;

        if (sources == null || sources.length == 0) {
            console.log('The channel has no sources');
            continue;
        }

        let needToSendCount = channel.dailyPosts; //ожидаемое количество постов в канал

        if (needToSendCount <= 0) {
            console.log(`Skip channel. dailyPosts=${needToSendCount}`);
            continue;
        }

        for (const source of sources) {

            console.log(`---------------------------------------> SOURCE: ${source.name} | ${source.sub_source} |types: [${source.type}] | count: ${source.maxPosts}`);
            var sended = 0;//количество успешно отправленных постов в канал

            source.maxPosts = needToSendCount < source.maxPosts ? needToSendCount : source.maxPosts;

            if (source.name == SOURCE.REDDIT) {
                sended = await useReddit(channel, source);
            } else if (source.name == SOURCE.VK) {
                sended = await useVk(channel, source);
            }

            needToSendCount -= sended;

            if (needToSendCount <= 0) {
                break;
            }
        }

        console.log(`-----------------------------------> TOTAL [channel: ${channel.channel_name}] ${channel.dailyPosts - needToSendCount}/${channel.dailyPosts} <-----------------------------------\n\n`);
    }
}

module.exports = {startScript };
