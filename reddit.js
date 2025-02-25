const fs = require('fs');
const axios = require('axios');
const https = require('https');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static'); // Optional: Use ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegPath || '/path/to/ffmpeg');

const { BOT_TOKEN, SOURCE, MEDIA_TYPE, lastIndexDir, lastIndexSuff, downloadDirectoryBase, combineStringsForCaption } = require('./system.js');

let sorting = 'top';
let time = 'all';
const postDelayMilliseconds = 250;

async function useReddit(channelSettings, currentSource) {
    if (currentSource.name != SOURCE.REDDIT) {
        return;
    }

    const sub_source = currentSource.sub_source;

    let file = `${lastIndexDir}/${channelSettings.channel_name}_${SOURCE.REDDIT}_${sub_source}${lastIndexSuff}`;

    if (!fs.existsSync(file)) {
        console.log('is not exist: ' + file);
        fs.writeFileSync(file, '');
        console.log('create file: ' + file);
    }

    let lastIndex = fs.readFileSync(file, 'utf8');
    console.log('last index: ' + lastIndex);

    let needToSendCount = currentSource.dailyPosts;

    while (needToSendCount > 0) {

        console.log(`Fetch ${needToSendCount} posts`);

        try {

            if (!lastIndex || lastIndex == '' || lastIndex == null) {
                lastIndex = currentSource.startId;
            }

            const result = await fetchSubredditPosts(sub_source, lastIndex, needToSendCount);

            if (result == null || result.length === 0) {
                console.log('---------> No posts found. <---------');
                return;
            }

            const index = result[result.length - 1].data.name;
            fs.writeFileSync(file, index);

            for (const post of result) {
                try {
                    var isSended = await processPost(channelSettings.id, currentSource.type, channelSettings.messageSufix, post.data);
                    needToSendCount -= isSended ? 1 : 0;
                    await sleep();
                } catch (e) {
                    console.log('processPost error: ' + e.message);
                    log(e, true);
                }
            }

        } catch (error) {
            console.log('Error with subreddit: ' + sub_source + '. Error message: ' + error.message);
        }
    }
    console.log('REDDIT Completed.');
}

async function fetchSubredditPosts(subreddit, lastPostId, count) {
    try {
        const response = await axios.get(
            `https://reddit-proxy.artsyom-avanesov.workers.dev/?url=https://www.reddit.com/r/${subreddit}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${count}&after=${lastPostId}`,
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

async function processPost(chatId, availableTypes, messageSufix, post) {
    const postType = getPostType(post);

    if ((postType === 'media' && post.url) || post.post_hint.includes('video')) {
        if (post.post_hint === 'image' && availableTypes.includes(MEDIA_TYPE.IMAGE)) {
            return await sendImageToTelegram(chatId, messageSufix, post);
        } else if (post.post_hint.includes('video') && availableTypes.includes(MEDIA_TYPE.VIDEO)) {
            return await sendVideoToTelegram(chatId, messageSufix, post);
        }
    } else if (postType === 'gallery' && availableTypes.includes(MEDIA_TYPE.IMAGE)) {
        return await sendGalleryToTelegram(chatId, messageSufix, post);
    } else {
        console.log(`Unsupported type ${postType} (${post.post_hint})`);
        return false;
    }
}

async function sendImageToTelegram(chatId, messageSufix, post) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
            {
                chat_id: chatId,
                photo: post.url,
                caption: combineStringsForCaption(post.title, messageSufix),
                parse_mode: 'HTML'
            }
        );
        console.log('Image sent successfully!');

        return true;
    } catch (error) {
        console.error('Error sending image:', error.message);
    }

    return false;
}

async function sendVideoToTelegram(chatId, messageSufix, post) {
    var videoUrl = post.secure_media?.reddit_video?.fallback_url?.split('?')[0];
    if (!videoUrl) return false;

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

    if (!audio) return false;

    const audioFileName = videoFileName.replace('.mp4', '-audio.mp4');

    const videoFilePath = `${downloadDir}/${videoFileName}`;
    const audioFilePath = `${downloadDir}/${audioFileName}`;
    const mergedFilePath = `${downloadDir}/${videoFileName.replace('.mp4', '-merged.mp4')}`;

    var isSened = false;

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
        formData.append('chat_id', chatId); // Replace CHAT_ID with your actual chat ID
        formData.append('video', fs.createReadStream(mergedFilePath), { filename: 'video.mp4' }); // Attach the video file
        formData.append('caption', combineStringsForCaption(post.title, messageSufix)); // Add the caption
        formData.append('parse_mode', 'HTML');

        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`,
            formData,
        );
        console.log('Video sent successfully!');
        isSened = true;
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

        return isSened;
    }
}

async function sendGalleryToTelegram(chatId, messageSufix, post) {
    const mediaList = post.gallery_data.items.map(({ media_id }) => {
        const media = post.media_metadata[media_id];
        return { type: 'photo', media: media.s.u.replace('&', '&') };
    });

    try {
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`,
            {
                chat_id: chatId,
                media: mediaList,
                caption: combineStringsForCaption(post.title, messageSufix),
                parse_mode: 'HTML'
            }
        );
        console.log('Gallery sent successfully!');

        return true;
    } catch (error) {
        console.error('Error sending gallery:', error.message);
    }

    return false;
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

module.exports = { useReddit };
