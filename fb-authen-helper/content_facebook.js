console.log("Facebook Auto-Reply Content Script Loaded");

// Helper function to check if element is visible
function isElementVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// Simulated typing helper
async function simulateTyping(element, text) {
    element.focus();
    
    // Clear input
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
        element.value = "";
    } else {
        element.innerHTML = "";
    }
    
    for (let i = 0; i < text.length; i++) {
        const char = text.charAt(i);
        
        // Dispatch keydown
        element.dispatchEvent(new KeyboardEvent('keydown', { key: char }));
        
        // Update values
        if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
            element.value += char;
        } else {
            element.innerText = (element.innerText || "") + char;
        }
        
        // Dispatch input
        element.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Dispatch keypress/keyup
        element.dispatchEvent(new KeyboardEvent('keypress', { key: char }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key: char }));
        
        // Human typing variation
        await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 50));
    }
}

// Dispatch Enter event to submit form/reply
function dispatchEnter(element) {
    const events = ['keydown', 'keypress', 'keyup'];
    events.forEach(type => {
        element.dispatchEvent(new KeyboardEvent(type, {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        }));
    });
}

// 12-second loop to find the published post URL after posting
async function publishPost(postText) {
    console.log("Starting post link extraction for text:", postText);
    let fb_post_url = null;
    const startTime = Date.now();
    
    while (Date.now() - startTime < 12000) {
        // 1. Toast search
        const links = document.querySelectorAll('a');
        for (const link of links) {
            const text = (link.textContent || "").toLowerCase();
            if (text.includes("xem bài viết") || text.includes("view post") || text.includes("bài viết của bạn")) {
                if (link.href) {
                    fb_post_url = link.href;
                    break;
                }
            }
        }
        
        if (fb_post_url) break;
        
        // 2. Feed top post search
        const articles = document.querySelectorAll('div[role="article"]');
        for (const article of articles) {
            const articleText = (article.textContent || "");
            if (articleText.includes(postText)) {
                // Find permalink a tag
                const articleLinks = article.querySelectorAll('a');
                for (const link of articleLinks) {
                    const href = link.href || "";
                    if (href.includes("/posts/") || href.includes("/permalink.php") || href.includes("/story.php") || href.includes("/groups/")) {
                        fb_post_url = href;
                        break;
                    }
                }
            }
            if (fb_post_url) break;
        }
        
        if (fb_post_url) break;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log("Post URL extraction complete. URL found:", fb_post_url);
    chrome.runtime.sendMessage({
        action: "publish_post_result",
        success: !!fb_post_url,
        fb_post_url: fb_post_url
    });
    
    return fb_post_url;
}

// Reply to a specific comment
async function handleReplyComment(data) {
    const { author, comment_text, reply_text } = data;
    console.log(`Searching for comment by ${author} to reply: "${reply_text}"`);
    
    // Find the comment block
    const commentBlocks = document.querySelectorAll('div[role="comment"], div[data-comment-id]');
    let targetBlock = null;
    
    for (const block of commentBlocks) {
        const text = block.textContent || "";
        if (text.includes(author) && text.includes(comment_text)) {
            targetBlock = block;
            break;
        }
    }
    
    if (!targetBlock) {
        console.warn("Could not find comment block for author:", author, "text:", comment_text);
        return;
    }
    
    // Find and click the Reply button
    const replyButtons = targetBlock.querySelectorAll('div[role="button"], span, a, button');
    let replyButton = null;
    for (const btn of replyButtons) {
        const txt = (btn.textContent || "").trim().toLowerCase();
        if (txt === "phản hồi" || txt === "reply") {
            replyButton = btn;
            break;
        }
    }
    
    if (!replyButton) {
        replyButton = targetBlock.querySelector('div[role="button"]');
    }
    
    if (replyButton) {
        replyButton.click();
        console.log("Clicked Reply button");
    } else {
        console.warn("Reply button not found inside comment block");
        return;
    }
    
    // Wait for the sub-comment input textbox to appear
    let inputField = null;
    const maxWait = 10;
    for (let i = 0; i < maxWait; i++) {
        inputField = targetBlock.querySelector('div[role="textbox"], div[contenteditable="true"], input');
        if (inputField && isElementVisible(inputField)) {
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (!inputField) {
        console.warn("Sub-comment input textbox not visible");
        return;
    }
    
    console.log("Typing reply...");
    await simulateTyping(inputField, reply_text);
    dispatchEnter(inputField);
    console.log("Submitted reply");
}

// Scrape comments and sync to backend via background script
let lastCommentsHash = "";
function syncComments() {
    const commentBlocks = document.querySelectorAll('div[role="comment"], div[data-comment-id]');
    if (commentBlocks.length === 0) return;

    let post_id = "fb_post_" + window.location.pathname.replace(/\//g, '_');
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("story_fbid")) {
        post_id = urlParams.get("story_fbid");
    } else if (window.location.pathname.includes("/posts/")) {
        const parts = window.location.pathname.split("/posts/");
        if (parts[1]) {
            post_id = parts[1].split("/")[0];
        }
    }

    const comments = [];
    commentBlocks.forEach(block => {
        const comment_id = block.getAttribute("data-comment-id") || "c_" + Math.random().toString(36).slice(2, 9);
        const authorEl = block.querySelector('span[dir="auto"] a, a[role="link"] span, strong, a');
        const author = authorEl ? (authorEl.textContent || "").trim() : "Anonymous";
        
        const textEl = block.querySelector('div[dir="auto"], span[dir="auto"], div[style*="text-align"]');
        const comment_text = textEl ? (textEl.textContent || "").trim() : "";
        
        if (comment_text) {
            comments.push({
                comment_id,
                post_id,
                author,
                comment_text
            });
        }
    });

    if (comments.length === 0) return;

    const hash = JSON.stringify(comments);
    if (hash === lastCommentsHash) return;
    lastCommentsHash = hash;

    console.log("Syncing comments:", comments);
    chrome.runtime.sendMessage({
        action: "fb_post_comments",
        post_id: post_id,
        comments: comments
    }, (response) => {
        if (chrome.runtime.lastError) {}
    });
}

// Listen for background page messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === "publish_post") {
        publishPost(message.postText).then(url => {
            sendResponse({ success: true, fb_post_url: url });
        });
        return true;
    }
    
    if (message && message.action === "reply_comment") {
        handleReplyComment(message);
        sendResponse({ success: true });
        return true;
    }
});

// Run comment synchronization loop every 4 seconds
setInterval(syncComments, 4000);
