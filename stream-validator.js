/**
 * Stream Validator
 * Validates stream URLs and handles errors gracefully
 */

class StreamValidator {
    constructor() {
        this.validatedStreams = new Map(); // url -> validation result
        this.timeout = 10000; // 10 seconds timeout
    }

    /**
     * Validate a stream URL
     * @param {string} url - Stream URL
     * @returns {Promise<Object>} Validation result
     */
    async validate(url) {
        // Check cache first
        if (this.validatedStreams.has(url)) {
            return this.validatedStreams.get(url);
        }

        const result = {
            url: url,
            valid: false,
            error: null,
            type: 'unknown',
            checked: false
        };

        try {
            // Quick HEAD request to check if URL is accessible
            const isValid = await this.checkURL(url);
            result.valid = isValid;
            result.checked = true;

            if (isValid) {
                result.type = this.detectStreamType(url);
            } else {
                result.error = 'Stream not accessible (404 or connection error)';
            }
        } catch (error) {
            result.error = error.message;
            result.valid = false;
            result.checked = true;
        }

        // Cache result
        this.validatedStreams.set(url, result);
        return result;
    }

    /**
     * Check if URL is accessible
     */
    async checkURL(url) {
        try {
            // If running in the Electron desktop app, use main-process fetch to avoid CORS.
            if (typeof window !== 'undefined' && window.m3uPlayerDesktop?.fetchStatus) {
                // For HLS/m3u8, do a GET to see if playlist is reachable.
                if (url.includes('.m3u8') || url.includes('hls')) {
                    const res = await window.m3uPlayerDesktop.fetchStatus(url, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*'
                        }
                    });
                    return !!res.ok;
                }

                // For other streams, a HEAD is fine (fallback to GET if server rejects HEAD).
                let res = await window.m3uPlayerDesktop.fetchStatus(url, { method: 'HEAD' });
                if (!res.ok && (res.status === 405 || res.status === 403)) {
                    res = await window.m3uPlayerDesktop.fetchStatus(url, {
                        method: 'GET',
                        headers: { 'Range': 'bytes=0-1024' }
                    });
                }
                return !!res.ok;
            }

            // For HLS/M3U8 streams, we can't use HEAD request
            // Instead, try to fetch the first few bytes
            if (url.includes('.m3u8') || url.includes('hls')) {
                return await this.checkHLSStream(url);
            }

            // For other streams, try HEAD request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            try {
                const response = await fetch(url, {
                    method: 'HEAD',
                    signal: controller.signal,
                    mode: 'no-cors' // Try no-cors first
                });
                
                clearTimeout(timeoutId);
                return true; // If we get here, it's likely accessible
            } catch (error) {
                // If HEAD fails, try GET with range
                clearTimeout(timeoutId);
                return await this.checkWithRange(url);
            }
        } catch (error) {
            console.warn('Stream validation error:', error);
            // Don't fail validation on CORS errors - let the player try
            return true; // Assume valid if we can't check (CORS issues)
        }
    }

    /**
     * Check HLS stream by fetching playlist
     */
    async checkHLSStream(url) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            const response = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain'
                }
            });

            clearTimeout(timeoutId);
            return response.ok;
        } catch (error) {
            // If we can't fetch, assume it might work (CORS issues)
            return true;
        }
    }

    /**
     * Check stream with Range request
     */
    async checkWithRange(url) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            const response = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Range': 'bytes=0-1024' // Request first 1KB
                }
            });

            clearTimeout(timeoutId);
            return response.ok || response.status === 206; // 206 is Partial Content
        } catch (error) {
            // Assume valid if we can't check
            return true;
        }
    }

    /**
     * Detect stream type from URL
     */
    detectStreamType(url) {
        const lowerUrl = url.toLowerCase();
        
        if (lowerUrl.includes('.m3u8') || lowerUrl.includes('hls')) {
            return 'HLS';
        } else if (lowerUrl.includes('.ts') || lowerUrl.includes('mpegts')) {
            return 'MPEG-TS';
        } else if (lowerUrl.includes('.mp4')) {
            return 'MP4';
        } else if (lowerUrl.includes('rtmp')) {
            return 'RTMP';
        } else if (lowerUrl.includes('rtsp')) {
            return 'RTSP';
        } else {
            return 'UNKNOWN';
        }
    }

    /**
     * Validate multiple streams in parallel (with limit)
     */
    async validateBatch(urls, limit = 5) {
        const results = [];
        
        // Process in batches to avoid overwhelming
        for (let i = 0; i < urls.length; i += limit) {
            const batch = urls.slice(i, i + limit);
            const batchResults = await Promise.all(
                batch.map(url => this.validate(url))
            );
            results.push(...batchResults);
        }
        
        return results;
    }

    /**
     * Clear validation cache
     */
    clearCache() {
        this.validatedStreams.clear();
    }

    /**
     * Mark stream as valid (skip validation)
     */
    markAsValid(url) {
        this.validatedStreams.set(url, {
            url: url,
            valid: true,
            error: null,
            type: this.detectStreamType(url),
            checked: true
        });
    }
}

