// NodeJS Dependencies
const fs = require('fs');
const axios = require('axios');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); // Optional: Use ffmpeg-static
const FormData = require('form-data');


// Set the FFmpeg path explicitly
ffmpeg.setFfmpegPath(ffmpegPath || '/path/to/ffmpeg');
const https = require('https');

// Configuration and constants
//let config = require('./user_config_DEFAULT.json');
const configChannel = require('./channels_config.json');
//const { precess } = require('process');
const SOURCE = { REDDIT: "reddit", VK: 'vk' };
const MEDIA_TYPE = { IMAGE: 'image', VIDEO: 'video' };
const lastIndexDir = './last_index';
const lastIndexSuff = '_last_index.txt';
const downloadDirectoryBase = './downloads';

//env variable
const BOT_TOKEN = process.env.BOT_TOKEN;
const VK_TOKEN = process.env.VK_TOKEN;

let sorting = 'top';
let time = 'all';
const postDelayMilliseconds = 250;

startScript();

async function startScript() {
    console.log('Start......');
    if (configChannel == null || configChannel.length == 0) {
        console.log('channel config is empty');
        return;
    }

    for (const channel of configChannel) {
        await sendToChannels(channel);
    }
}

async function sendToChannels(channelConfig) {
    if (channelConfig.dailyPosts <= 0) {
        console.log('Skip channel ' + channelConfig.channel_name);
        return;
    }

    if (!fs.existsSync(lastIndexDir)) {
        fs.mkdirSync(lastIndexDir, { recursive: true });
    }

    if (channelConfig.source == SOURCE.REDDIT) {
        console.log('Start [reddit]');

        for (const reddit of channelConfig.sub_source) {

            console.log('subreddit: ' + reddit);

            let file = `${lastIndexDir}/${SOURCE.REDDIT}_${reddit}${lastIndexSuff}`;
            if (!fs.existsSync(file)) {
                fs.writeFileSync(file, '');
            }

            const lastIndex = fs.readFileSync(file, 'utf8');
            console.log('last index: ' + lastIndex);


            try {
                const result = await fetchSubredditPosts(reddit, lastIndex, channelConfig);

                if (result == null || result.length === 0) {
                    console.log('No posts found.');
                    return;
                }

                const index = result[result.length - 1].data.name;
                fs.writeFileSync(file, index);

                for (const post of result) {
                    try {
                        await processPost(post.data, channelConfig);
                        await sleep();
                    } catch (e) {
                        console.log('processPost error: ' + e.message);
                        log(e, true);
                    }
                }

                console.log('Posts sent successfully.');
            } catch (error) {
                console.log('Error with subreddit: ' + reddit + '. Error message: ' + error.message);
            }
        }
    } else if (channelConfig.source == SOURCE.VK) {

        if (VK_TOKEN == null) {
            return;
        }

        console.log('Start [vk]');
        console.log('vk_groups: ' + channelConfig.sub_source);

        for (const group of channelConfig.sub_source) {

            console.log('group: ' + group);

            let file = `${lastIndexDir}/${SOURCE.VK}_${group}${lastIndexSuff}`;
            console.log('ckeck file: ' + file);
            if (!fs.existsSync(file)) {
                console.log('is not exist: ' + file);
                fs.writeFileSync(file, '');
                console.log('create file: ' + file);
            }
            const offset = fs.readFileSync(file, 'utf8');
            console.log('last index: ' + offset);
            try {
                const result = await fetchVkPosts(group, offset, channelConfig.dailyPosts);
                if (result == null || result.items.length === 0) {
                    console.log('No posts found.');
                    return;
                }

                fs.writeFileSync(file, result.next_from);

                for (const post of result.items) {
                    try {
                        await sendVkPostToTelegram(post, channelConfig);
                    } catch (error) {
                        console.error('Error post: ', error.message);
                    }
                }

                console.log('Posts sent successfully.');
            } catch (error) {
                console.log('Error with group: ' + group + '. Error message: ' + error.message);
            }
        }
    }
}

async function fetchSubredditPosts(subreddit, lastPostId, config) {
    if (!lastPostId) lastPostId = '';
    //let start_timestamp = int(config.startDate.strptime(start_date, "%Y-%m-%d").timestamp())

    try {
        const response = await axios.get(
            `https://reddit-proxy.artsyom-avanesov.workers.dev/?url=https://www.reddit.com/r/${subreddit}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${config.dailyPosts}&after=${lastPostId}`,
            {
                headers: {
                    'User-Agent': 'github.com/KirillSnopko/reddit_publisher/job',
                },
                httpsAgent: new https.Agent({ rejectUnauthorized: false })
            },
        );
        const data = response.data;

        console.log(`reddit request [${subreddit}]: ${data.data.children != null ? 'OK' : 'FAIL'}`);

        if (data.message === 'Not Found' || !data.data.children.length) {
            throw new Error('Subreddit not found or private.');
        }

        return data.data.children;
    } catch (error) {
        console.error(`Error fetching posts for ${subreddit}:`, error.response ? error.response.data : error.message);
        return null;
    }
}

async function processPost(post, config) {
    const postType = getPostType(post);
    const types = config.type;
    if ((postType === 'media' && post.url) || post.post_hint.includes('video')) {
        if (post.post_hint === 'image' && types.includes(MEDIA_TYPE.IMAGE)) {
            await sendImageToTelegram(post, config);
        } else if (post.post_hint.includes('video') && types.includes(MEDIA_TYPE.VIDEO)) {
            await sendVideoToTelegram(post, config);
        }
    } else if (postType === 'gallery' && types.includes(MEDIA_TYPE.IMAGE)) {
        await sendGalleryToTelegram(post, config);
    } else {
        console.log(`Unsupported type ${postType} (${post.post_hint})`);
    }
}

async function sendImageToTelegram(post, config) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
            {
                chat_id: config.id,
                photo: post.url,
                caption: post.title + config.messageSufix,
                parse_mode: 'HTML'
            }
        );
        console.log('Image sent successfully!');
    } catch (error) {
        console.error('Error sending image:', error.message);
    }
}

async function sendVideoToTelegram(post, config) {
    var videoUrl = post.secure_media?.reddit_video?.fallback_url?.split('?')[0];
    if (!videoUrl) return;

    const downloadDir = `${downloadDirectoryBase}/${post.subreddit}`;

    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    const videoFileName = getFileName(post) + '.mp4';

    let audio = false;
    var audioUrl = `${post.secure_media?.reddit_video?.fallback_url?.split('DASH')[0]}audio`;//videoUrl.substring(0, videoUrl.lastIndexOf('/') + 1) + 'audio';

    if (videoUrl.match('.mp4')) {
        audioUrl = `${videoUrl.split('_')[0]}_audio.mp4`
    }

    // test the existence of audio
    await fetch(audioUrl, { method: "HEAD" }).then(r => {
        if (Number(r.status) === 200) {
            audio = true
        }
    }).catch(() => { })

    // fallback for videos with variable audio quality
    if (!audio) {
        audioUrl = `${videoUrl.split('_')[0]}_AUDIO_128.mp4`
        await fetch(audioUrl, { method: "HEAD" }).then(r => {
            if (Number(r.status) === 200) {
                audio = true
            }
        }).catch(() => { })
    }

    if (!audio) return;

    const audioFileName = videoFileName.replace('.mp4', '-audio.mp4');

    const videoFilePath = `${downloadDir}/${videoFileName}`;
    const audioFilePath = `${downloadDir}/${audioFileName}`;
    const mergedFilePath = `${downloadDir}/${videoFileName.replace('.mp4', '-merged.mp4')}`;

    try {
        await Promise.all([
            downloadMediaFile(videoUrl, videoFilePath),
            downloadMediaFile(audioUrl, audioFilePath),
        ]);
        var test = await new Promise((resolve, reject) => {
            ffmpeg()
                .input(videoFilePath)
                .input(audioFilePath)
                .output(mergedFilePath)
                .on('end', () => {
                    console.log('Merge completed successfully.');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('An error occurred while merging files:', err.message);
                    reject(err); // Reject the promise if an error occurs
                })
                .run();
        });

        const formData = new FormData();
        formData.append('chat_id', config.id); // Replace CHAT_ID with your actual chat ID
        formData.append('video', fs.createReadStream(mergedFilePath), { filename: 'video.mp4' }); // Attach the video file
        formData.append('caption', post.title + config.messageSufix); // Add the caption
        formData.append('parse_mode', 'HTML');

        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`,
            formData,
        );
        console.log('Video sent successfully!');
    } catch (error) {
        console.error('Error processing video:', error.message);
    } finally {
        if (fs.existsSync(mergedFilePath)) {
            fs.unlinkSync(mergedFilePath);
            console.log(`Remove merged file:${mergedFilePath}`);
        }
        if (fs.existsSync(videoFilePath)) {
            fs.unlinkSync(videoFilePath);
            console.log(`Remove video file:${videoFilePath}`);
        }
        if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
            console.log(`Remove audio file:${audioFilePath}`);
        }
    }
}

async function sendGalleryToTelegram(post, config) {
    const mediaList = post.gallery_data.items.map(({ media_id }) => {
        const media = post.media_metadata[media_id];
        return { type: 'photo', media: media.s.u.replace('&', '&') };
    });

    try {
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`,
            {
                chat_id: config.id,
                media: mediaList,
                caption: post.title + config.messageSufix,
                parse_mode: 'HTML'
            }
        );
        console.log('Gallery sent successfully!');
    } catch (error) {
        console.error('Error sending gallery:', error.message);
    }
}

function getPostType(post) {
    if (post.post_hint === 'self' || post.is_self) return 'self';
    if (post.post_hint === 'image' || post.domain.includes('i.redd.it') || post.post_hint.includes('video')) return 'media';
    if (post.domain.includes('reddit.com') && post.is_gallery) return 'gallery';
    return 'link';
}

async function downloadMediaFile(url, filePath) {
    try {
        const response = await axios({ method: 'GET', url, responseType: 'stream' });
        response.data.pipe(fs.createWriteStream(filePath));
        return new Promise((resolve, reject) => {
            response.data.on('end', resolve).on('error', reject);
        });
    } catch (error) {
        console.error('Error downloading media:', error.message);
    }
}

function getFileName(post) {
    let fileName = '';
    const date = new Date(post.created * 1000);
    fileName += `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    fileName += `_score=${post.score}`;
    return fileName.slice(0, 240).replace(/[\uFE0E\uFE0F]/g, '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function sleep() {
    return new Promise((resolve) => setTimeout(resolve, postDelayMilliseconds));
}

async function fetchVkPosts(vkGroupId, offset, count) {
    try {
        const response = await axios.get('https://api.vk.com/method/wall.get', {
            params: {
                access_token: VK_TOKEN,
                v: '5.131', // VK API version
                owner_id: vkGroupId, // Group ID
                count: count, // Number of posts to fetch
                filter: 'owner', // Fetch only posts from the group itself
                offset: offset
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

    title += config.messageSufix;

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
