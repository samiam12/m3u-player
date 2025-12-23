/**
 * M3U Playlist Parser
 * Parses M3U/M3U8 playlists and extracts channel information
 */

class M3UParser {
    constructor() {
        this.channels = [];
    }

    /**
     * Parse M3U content from text or URL
     * @param {string} content - M3U content or URL
     * @returns {Promise<Array>} Array of channel objects
     */
    async parse(content) {
        try {
            let m3uContent = content;
            
            // If it's a URL, fetch it
            if (this.isURL(content)) {
                m3uContent = await this.fetchURL(content);
            }
            
            return this.parseContent(m3uContent);
        } catch (error) {
            console.error('Error parsing M3U:', error);
            throw new Error(`Failed to parse M3U: ${error.message}`);
        }
    }

    /**
     * Check if string is a URL
     */
    isURL(str) {
        try {
            new URL(str);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Fetch content from URL with CORS proxy fallback
     */
    async fetchURL(url) {
        // If running inside the Electron desktop app, use the main-process fetch bridge
        // so we don't need a separate local proxy server.
        if (typeof window !== 'undefined' && window.m3uPlayerDesktop?.fetchText) {
            const res = await window.m3uPlayerDesktop.fetchText(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*'
                }
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            return res.text;
        }

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*'
                },
                mode: 'cors'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.text();
        } catch (error) {
            // If CORS fails, try server proxy first, then public proxies
            if (error.message.includes('CORS') || error.message.includes('Failed to fetch')) {
                console.warn('Direct fetch failed, trying server proxy...');
                try {
                    return await this.fetchWithServerProxy(url);
                } catch (serverError) {
                    console.warn('Server proxy failed, trying public proxies...');
                    return await this.fetchWithProxy(url);
                }
            }
            throw error;
        }
    }

    /**
     * Fetch using local server proxy (if available)
     */
    async fetchWithServerProxy(url) {
        const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Proxy HTTP ${response.status}: ${response.statusText}`);
        }
        
        const text = await response.text();
        if (text.includes('#EXTM3U') || text.includes('#EXTINF')) {
            return text;
        }
        throw new Error('Proxy returned invalid M3U');
    }

    /**
     * Fetch with CORS proxy
     */
    async fetchWithProxy(url) {
        // Try multiple CORS proxy services
        const proxies = [
            `https://api.allorigins.win/raw?url=`,
            `https://corsproxy.io/?`,
            `https://api.codetabs.com/v1/proxy?quest=`
        ];

        for (const proxy of proxies) {
            try {
                const proxyUrl = proxy + encodeURIComponent(url);
                const response = await fetch(proxyUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*'
                    }
                });
                
                if (response.ok) {
                    const text = await response.text();
                    // Check if it's actually M3U content
                    if (text.includes('#EXTM3U') || text.includes('#EXTINF')) {
                        return text;
                    }
                }
            } catch (e) {
                console.warn(`Proxy ${proxy} failed:`, e);
                continue;
            }
        }
        
        throw new Error('All CORS proxy attempts failed. M3U may not be accessible due to CORS restrictions.');
    }

    /**
     * Parse M3U content
     */
    parseContent(content) {
        const lines = content.split('\n').map(line => line.trim()).filter(line => line);
        const channels = [];
        let currentChannel = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check if it's an EXTINF line
            if (line.startsWith('#EXTINF:')) {
                currentChannel = this.parseExtInf(line);
            }
            // Check if it's a URL (stream URL)
            else if (currentChannel && !line.startsWith('#')) {
                currentChannel.url = line;
                currentChannel.id = this.generateChannelId(currentChannel);
                
                // Extract additional info from URL if available
                this.extractURLInfo(currentChannel, line);
                
                channels.push(currentChannel);
                currentChannel = null;
            }
            // Handle other M3U tags
            else if (line.startsWith('#EXT')) {
                if (currentChannel) {
                    this.parseExtTag(currentChannel, line);
                }
            }
        }

        this.channels = channels;
        return channels;
    }

    /**
     * Parse EXTINF line
     * Format: #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="..." [title]
     */
    parseExtInf(line) {
        const channel = {
            name: '',
            url: '',
            tvgId: '',
            tvgName: '',
            tvgLogo: '',
            groupTitle: '',
            category: '',
            duration: -1,
            attributes: {}
        };

        // Extract duration and attributes
        const match = line.match(/^#EXTINF:(-?\d+)(?:\s+(.+))?$/);
        if (match) {
            channel.duration = parseInt(match[1]) || -1;
            const attributesPart = match[2] || '';

            // Extract quoted attributes
            const attrPattern = /(\w+(?:-\w+)*)="([^"]*)"/g;
            let attrMatch;
            while ((attrMatch = attrPattern.exec(attributesPart)) !== null) {
                const key = attrMatch[1];
                const value = attrMatch[2];
                channel.attributes[key] = value;

                // Map common attributes
                if (key === 'tvg-id') channel.tvgId = value;
                if (key === 'tvg-name') channel.tvgName = value;
                if (key === 'tvg-logo') channel.tvgLogo = value;
                if (key === 'group-title') {
                    channel.groupTitle = value;
                    channel.category = value;
                }
            }

            // Extract channel name (last unquoted part)
            const nameMatch = attributesPart.match(/,([^,]+)$/);
            if (nameMatch) {
                channel.name = nameMatch[1].trim();
            } else {
                // Fallback: use tvg-name or first unquoted text
                channel.name = channel.tvgName || attributesPart.split(',')[0].trim();
            }
        }

        // Use tvg-name if name is empty
        if (!channel.name && channel.tvgName) {
            channel.name = channel.tvgName;
        }

        return channel;
    }

    /**
     * Parse additional EXT tags
     */
    parseExtTag(channel, line) {
        // Handle #EXTGRP
        if (line.startsWith('#EXTGRP:')) {
            const group = line.substring(8).trim();
            if (group && !channel.groupTitle) {
                channel.groupTitle = group;
                channel.category = group;
            }
        }
        // Handle #EXTIMG
        else if (line.startsWith('#EXTIMG:')) {
            const logo = line.substring(8).trim();
            if (logo && !channel.tvgLogo) {
                channel.tvgLogo = logo;
            }
        }
    }

    /**
     * Extract info from URL
     */
    extractURLInfo(channel, url) {
        try {
            const urlObj = new URL(url);
            const lowerUrl = url.toLowerCase();
            
            // Detect stream type - prioritize MPEG-TS detection
            // MPEG-TS streams are typically direct HTTP streams, not HLS
            if (lowerUrl.includes('.ts') || 
                lowerUrl.includes('mpegts') || 
                lowerUrl.includes('mpeg-ts') ||
                lowerUrl.includes('/ts/') ||
                (lowerUrl.includes('http') && !lowerUrl.includes('.m3u8') && !lowerUrl.includes('hls'))) {
                // Check if it's actually HLS by looking for .m3u8
                if (lowerUrl.includes('.m3u8') || lowerUrl.includes('/hls/')) {
                    channel.streamType = 'HLS';
                } else {
                    // Likely MPEG-TS direct stream
                    channel.streamType = 'MPEG-TS';
                }
            } else if (lowerUrl.includes('.m3u8') || lowerUrl.includes('/hls/') || lowerUrl.includes('hls')) {
                channel.streamType = 'HLS';
            } else if (lowerUrl.includes('.mp4') || lowerUrl.includes('mp4')) {
                channel.streamType = 'MP4';
            } else if (lowerUrl.includes('rtmp')) {
                channel.streamType = 'RTMP';
            } else if (lowerUrl.includes('rtsp')) {
                channel.streamType = 'RTSP';
            } else {
                // Default to MPEG-TS for HTTP streams (most common for IPTV)
                channel.streamType = 'MPEG-TS';
            }

            // Store protocol
            channel.protocol = urlObj.protocol.replace(':', '');
        } catch (e) {
            // Invalid URL, default to MPEG-TS
            channel.streamType = 'MPEG-TS';
        }
    }

    /**
     * Generate unique channel ID
     */
    generateChannelId(channel) {
        // Use tvg-id if available, otherwise generate from name and URL
        if (channel.tvgId) {
            return channel.tvgId;
        }
        
        // Generate hash from name and URL
        const str = `${channel.name}_${channel.url}`;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return `channel_${Math.abs(hash)}`;
    }

    /**
     * Get all unique categories
     */
    getCategories() {
        const categories = new Set();
        this.channels.forEach(channel => {
            if (channel.category || channel.groupTitle) {
                categories.add(channel.category || channel.groupTitle);
            }
        });
        return Array.from(categories).sort();
    }

    /**
     * Filter channels by category
     */
    filterByCategory(category) {
        if (!category) return this.channels;
        return this.channels.filter(channel => 
            (channel.category || channel.groupTitle) === category
        );
    }

    /**
     * Search channels
     */
    searchChannels(query) {
        if (!query) return this.channels;
        const lowerQuery = query.toLowerCase();
        return this.channels.filter(channel =>
            channel.name.toLowerCase().includes(lowerQuery) ||
            (channel.tvgName && channel.tvgName.toLowerCase().includes(lowerQuery)) ||
            (channel.category && channel.category.toLowerCase().includes(lowerQuery))
        );
    }
}

