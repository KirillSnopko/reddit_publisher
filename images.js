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
let config = require('./user_config_DEFAULT.json');

const BOT_TOKEN = process.env.BOT_TOKEN; //"7010774003:AAG_QVhmaE_QERw1hUU9CFXP0L5szxCCcrQ";
const CHAT_ID = process.env.CHAT_ID; //-1002342607540
let subredditList = process.env.SUBREDDIT_LIST != null ? JSON.parse(process.env.SUBREDDIT_LIST) : [/*'Pikabu', 'MurderedByWords',*/ 'TikTokCringe'];
let numberOfPosts = process.env.NUMBER_OF_POSTS ?? 1;

const lastIndexSuff = '_last_index.txt';
const logFormat = 'txt';
let sorting = 'top';
let time = 'all';
let downloadDirectoryBase = './downloads';
const postDelayMilliseconds = 250;

let downloadedPosts = {
    subreddit: '',
    self: 0,
    media: 0,
    link: 0,
    failed: 0,
};

startScript();

async function startScript() {
    console.log('Start');
    console.log('subreddits: ' + process.env.SUBREDDIT_LIST);

    for (const reddit of subredditList) {
        console.log('subreddit: ' + reddit);
        if (!fs.existsSync(reddit + lastIndexSuff)) {
            fs.writeFileSync(reddit + lastIndexSuff, '');
        }
        const lastIndex = fs.readFileSync(reddit + lastIndexSuff, 'utf8');
        console.log('last index: ' + lastIndex);
        try {
            await downloadSubredditPosts(reddit, lastIndex);
        } catch (error) {
            console.log('Error with subreddit: ' + reddit + '. Error message: ' + error.message);
        }
    }
}

async function downloadSubredditPosts(subreddit, lastPostId) {
    if (!lastPostId) lastPostId = '';

    makeDirectories();
    try {
        const response = await axios.get(
            `https://reddit-proxy.artsyom-avanesov.workers.dev/?url=https://www.reddit.com/r/${subreddit}/${sorting}/.json?sort=${sorting}&t=${time}&limit=${numberOfPosts}&after=${lastPostId}`,
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

        const index = data.data.children[data.data.children.length - 1].data.name;
        fs.writeFileSync(subreddit + lastIndexSuff, index);

        downloadedPosts.subreddit = data.data.children[0].data.subreddit;
        const isOver18 = data.data.children[0].data.over_18 ? 'nsfw' : 'clean';

        const downloadPath = `${downloadDirectoryBase}/${isOver18}/${subreddit}`;
        if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath, { recursive: true });

        for (const child of data.data.children) {
            try {
                await processPost(child.data);
                await sleep();
            } catch (e) {
                console.log('processPost error: ' + e.message);
                log(e, true);
            }
        }
    } catch (error) {
        console.error(`Error fetching posts for ${subreddit}:`, error.response ? error.response.data : error.message);
    }
}

async function processPost(post) {
    const postType = getPostType(post);
    if ((postType === 'media' && post.url) || post.post_hint.includes('video')) {
        if (post.post_hint === 'image') {
            await sendImageToTelegram(post);
        } else if (post.post_hint.includes('video')) {
            await sendVideoToTelegram(post);
        }
    } else if (postType === 'gallery') {
        await sendGalleryToTelegram(post);
    } else {
        console.log(`Unsupported type ${postType} (${post.post_hint})`);
    }
}

async function sendImageToTelegram(post) {
    try {
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
            {
                chat_id: CHAT_ID,
                photo: post.url,
                caption: post.title,
            }
        );
        console.log('Image sent successfully!');
    } catch (error) {
        console.error('Error sending image:', error.message);
    }
}

async function sendVideoToTelegram(post) {
    var videoUrl = post.secure_media?.reddit_video?.fallback_url?.split('?')[0];
    if (!videoUrl) return;

    const downloadDir = `downloads/${subredditList[0]}`;
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
        formData.append('chat_id', CHAT_ID); // Replace CHAT_ID with your actual chat ID
        formData.append('video', fs.createReadStream(mergedFilePath), { filename: 'video.mp4' }); // Attach the video file
        formData.append('caption', post.title); // Add the caption

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

async function sendGalleryToTelegram(post) {
    const mediaList = post.gallery_data.items.map(({ media_id }) => {
        const media = post.media_metadata[media_id];
        return { type: 'photo', media: media.s.u.replace('&', '&') };
    });

    try {
        await axios.post(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`,
            {
                chat_id: CHAT_ID,
                media: mediaList,
                caption: post.title,
            }
        );
        console.log('Gallery sent successfully!');
    } catch (error) {
        console.error('Error sending gallery:', error.message);
    }
}

function getPostType(post) {
    if (post.post_hint === 'self' || post.is_self) return 'self';
    if (post.post_hint === 'image' || post.domain.includes('i.redd.it')) return 'media';
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

function makeDirectories() {
    if (!fs.existsSync(downloadDirectoryBase)) fs.mkdirSync(downloadDirectoryBase, { recursive: true });
    if (config.separate_clean_nsfw) {
        fs.mkdirSync(`${downloadDirectoryBase}/clean`, { recursive: true });
        fs.mkdirSync(`${downloadDirectoryBase}/nsfw`, { recursive: true });
    }
}

function getFileName(post) {
    let fileName = '';
    if (config.file_naming_scheme.showDate) {
        const date = new Date(post.created * 1000);
        fileName += `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    if (config.file_naming_scheme.showScore) fileName += `_score=${post.score}`;
    //if (config.file_naming_scheme.showSubreddit) fileName += `_${post.subreddit}`;
    //if (config.file_naming_scheme.showAuthor) fileName += `_${post.author}`;
    // if (config.file_naming_scheme.showTitle) fileName += `_${sanitizeFileName(post.title)}`;
    return fileName.slice(0, 240).replace(/[\uFE0E\uFE0F]/g, '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function sanitizeFileName(fileName) {
    return fileName.replace(/[/\\?%*:|"<>]/g, '-').replace(/([^/])\/([^/])/g, '$1_$2');
}

function checkIfDone() {
    console.log('All downloads completed.');
}

function sleep() {
    return new Promise((resolve) => setTimeout(resolve, postDelayMilliseconds));
}