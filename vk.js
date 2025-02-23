const fs = require('fs');
const axios = require('axios');
const https = require('https');
const { BOT_TOKEN, SOURCE, MEDIA_TYPE, lastIndexDir, lastIndexSuff, VK_TOKEN, combineStringsForCaption, currentDate } = require('./system.js');



async function useVk(channel) {
    if (channel.source != SOURCE.VK) {
        return;
    }

    if (VK_TOKEN == null) {
        console.error('Skip vk: token is null');
        return;
    }

    console.log('Start [vk]');
    console.log('vk_groups: ' + channel.sub_source);
    let count = channel.dailyPosts * 2; //2 это кол-во итераций в день

    for (const group of channel.sub_source) {

        console.log('group: ' + group);

        let file = `${lastIndexDir}/${SOURCE.VK}_${group}${lastIndexSuff}`;
        console.log('ckeck file: ' + file);
        if (!fs.existsSync(file)) {
            console.log('is not exist: ' + file);
            fs.writeFileSync(file, '');
            console.log('create file: ' + file);           
        }
        let lastPostDate = fs.readFileSync(file, 'utf8');
        console.log('last post date: ' + lastPostDate);
        try {
            const result = await fetchVkPosts(group, channel.dailyPosts);
            if (result == null || result.items.length === 0) {
                console.log('No posts found.');
                continue;
            }

            var posts = result.items;

            if (lastPostDate == '') {
                posts = posts.sort((a, b) => a.date - b.date).slice(0, channel.dailyPosts);
            } else {
                posts = posts.filter(x => x.date > lastPostDate).sort((a, b) => a.date - b.date).slice(0, channel.dailyPosts);
            }

            if (posts.length === 0) {
                console.log('No actual posts found.');
                continue;
            }

            lastPostDate = posts[posts.length - 1].date;

            fs.writeFileSync(file, `${lastPostDate}`);

            for (const post of posts) {
                try {
                    await sendVkPostToTelegram(post, channel);
                } catch (error) {
                    console.error('Error post: ', error.message);
                }
            }

            console.log('VK Completed.');
        } catch (error) {
            console.log('Error with group: ' + group + '. Error message: ' + error.message);
        }
    }
}

async function fetchVkPosts(vkGroupId, count) {
    try {
        const response = await axios.get('https://api.vk.com/method/wall.get', {
            params: {
                access_token: VK_TOKEN,
                v: '5.131',
                owner_id: vkGroupId,
                count: count,
                filter: 'all',
                offset: 0
            }
        });

        if (response.data && response.data.response) {
            return response.data.response;
        } else {
            console.error('Error fetching VK posts:', response.data.error || 'Unknown error');
            return null;
        }
    } catch (error) {
        console.error('Error in fetchVkPosts:', error.message);
        return null;
    }
}

async function sendVkPostToTelegram(post, config) {

    if (!post.attachments) {
        console.log('Skip post, empty attachments');
        return;
    }
    const types = config.type;
    const chatId = config.id;

    var attachments = post.attachments;

    const imageUrls = [];
    const videoUrls = [];
    var title = post.text;
    const prefix = 'Video:';

    for (const attachment of attachments) {
        if (attachment.type == 'photo' && types.includes(MEDIA_TYPE.IMAGE)) {
            imageUrls.push(attachment.photo.sizes.pop().url);
            console.log('Post type: photo')
        } else if (attachment.type == 'video' && types.includes(MEDIA_TYPE.VIDEO)) {
            var videoUrl = await getVkVideoUrl(attachment.video.owner_id, attachment.video.id, attachment.video.access_key);

            if (videoUrl != '' && videoUrl != null) {
                console.log('Video: receice correct link');
                videoUrls.push(videoUrl);
            } else {
                console.log('Video: use as text');
                title += `\n${prefix} vk.com/video${attachment.video.owner_id}_${attachment.video.id}`;
            }
        }
    }

    //max 1024
    title = combineStringsForCaption(title, config.messageSufix);

    if (videoUrls.length == 0 && imageUrls.length == 0) {
        return;
    }
    else if (videoUrls.length == 1 && imageUrls.length == 0) {

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
            chat_id: chatId,
            video: videoUrls[0],
            caption: title,
            parse_mode: 'HTML'
        });

        console.log('Singe video sent successfully!');
    }
    else if (videoUrls.length == 0 && imageUrls.length == 1) {

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
            chat_id: chatId,
            photo: imageUrls[0],
            caption: title,
            parse_mode: 'HTML'
        });

        console.log('Singe image sent successfully!');
    } else {
        var mediaArray = [];

        videoUrls.forEach(url => {
            mediaArray.push({
                type: 'video',
                media: url
            });
        });

        imageUrls.forEach(url => {
            mediaArray.push({
                type: 'photo',
                media: url
            });
        });

        mediaArray[0].caption = title;
        mediaArray[0].parse_mode = 'HTML';

        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`,
            {
                chat_id: chatId,
                media: mediaArray,
                caption: post.title + title,
                parse_mode: 'HTML'
            }
        );
        console.log('Gallery sent successfully!');
    }
}

async function getVkVideoUrl(ownerId, videoId, accessKey) {
    try {
        const response = await axios.get('https://api.vk.com/method/video.get', {
            params: {
                access_token: VK_TOKEN,
                v: '5.131',
                videos: `${ownerId}_${videoId}_${accessKey}`
            }
        });

        if (response.data && response.data.response && response.data.response.items.length > 0) {
            return response.data.response.items[0].files?.mp4_720 || response.data.response.items[0].files?.mp4_480 || '';
        } else {
            console.warn('Failed to retrieve video URL:', response.data.error || 'Unknown error');
            return '';
        }
    } catch (error) {
        console.error('Error fetching video URL:', error.message);
        return '';
    }
}

module.exports = { useVk };