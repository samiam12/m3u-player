/**
 * EPG (XMLTV) Parser
 * Parses XMLTV format EPG files and aligns with channels
 */

class EPGParser {
    constructor() {
        this.programs = new Map(); // channelId -> array of programs
        this.channelMap = new Map(); // channelId -> channel info
    }

    /**
     * Parse EPG content from text or URL
     * @param {string} content - EPG XML content or URL
     * @returns {Promise<Object>} Parsed EPG data
     */
    async parse(content) {
        try {
            let xmlContent = content;
            
            // If it's a URL, fetch it
            if (this.isURL(content)) {
                xmlContent = await this.fetchURL(content);
            }
            
            return this.parseXML(xmlContent);
        } catch (error) {
            console.error('Error parsing EPG:', error);
            throw new Error(`Failed to parse EPG: ${error.message}`);
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
                    'Accept': 'application/xml, text/xml, */*'
                }
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            return res.text;
        }

        // Always try server proxy first (works better on mobile/iPad)
        // Server proxy handles CORS properly
        try {
            console.log('Fetching EPG via server proxy (recommended for mobile devices)...');
            return await this.fetchWithServerProxy(url);
        } catch (serverError) {
            console.warn('Server proxy failed, trying direct fetch...', serverError);
            
            // Fallback to direct fetch
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/xml, text/xml, */*'
                    },
                    mode: 'cors'
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                return await response.text();
            } catch (directError) {
                // If direct fetch also fails, try public proxies as last resort
                if (directError.message.includes('CORS') || directError.message.includes('Failed to fetch')) {
                    console.warn('Direct fetch failed, trying public proxies...');
                    try {
                        return await this.fetchWithProxy(url);
                    } catch (proxyError) {
                        console.error('All EPG fetch methods failed');
                        throw new Error(`EPG fetch failed: ${proxyError.message}`);
                    }
                }
                throw directError;
            }
        }
    }

    /**
     * Fetch using local server proxy (if available)
     */
    async fetchWithServerProxy(url) {
        try {
            const proxyUrl = `/proxy?url=${encodeURIComponent(url)}`;
            console.log('Fetching EPG via server proxy:', proxyUrl.substring(0, 100) + '...');
            
            // Create abort controller for timeout (compatible with older browsers)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
            
            const response = await fetch(proxyUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/xml, text/xml, */*'
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                let errorText = 'Unknown error';
                try {
                    errorText = await response.text();
                    // Limit error text length
                    if (errorText.length > 200) {
                        errorText = errorText.substring(0, 200) + '...';
                    }
                } catch (e) {
                    // Ignore error reading response
                }
                throw new Error(`Proxy HTTP ${response.status}: ${response.statusText}`);
            }
            
            const text = await response.text();
            console.log('EPG proxy response received, length:', text.length);
            
            // Check if it's valid XML - be more lenient
            const trimmed = text.trim();
            if (trimmed.startsWith('<?xml') || 
                trimmed.startsWith('<tv') || 
                trimmed.includes('<tv>') ||
                trimmed.includes('<programme') ||
                trimmed.includes('<channel')) {
                console.log('EPG XML validated successfully');
                return text;
            }
            
            // Check if proxy returned an error page
            if (text.includes('<html>') || text.includes('<!DOCTYPE')) {
                throw new Error('Proxy returned HTML page instead of XML - check server logs');
            }
            
            // If we got here, it might still be valid XML with different format
            console.warn('EPG response format unclear, attempting to parse anyway...');
            return text;
        } catch (error) {
            // Handle timeout/abort specifically
            if (error.name === 'TimeoutError' || 
                error.name === 'AbortError' || 
                error.message.includes('aborted') ||
                error.message.includes('timeout')) {
                throw new Error('EPG fetch timeout - server may be slow or unreachable');
            }
            console.error('Server proxy fetch error:', error.message || error);
            throw error;
        }
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
                        'Accept': 'application/xml, text/xml, */*'
                    }
                });
                
                if (response.ok) {
                    const text = await response.text();
                    // Check if it's actually XML (proxy might return HTML error)
                    if (text.trim().startsWith('<?xml') || text.trim().startsWith('<tv')) {
                        return text;
                    }
                }
            } catch (e) {
                console.warn(`Proxy ${proxy} failed:`, e);
                continue;
            }
        }
        
        throw new Error('All CORS proxy attempts failed. EPG may not be accessible due to CORS restrictions.');
    }

    /**
     * Parse XML content
     */
    parseXML(xmlContent) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
        
        // Check for parsing errors
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
            throw new Error('Invalid XML format');
        }

        // Parse channels
        const channels = xmlDoc.querySelectorAll('channel');
        channels.forEach(channel => {
            const id = channel.getAttribute('id');
            if (id) {
                const displayName = channel.querySelector('display-name');
                const icon = channel.querySelector('icon');
                
                this.channelMap.set(id, {
                    id: id,
                    name: displayName ? displayName.textContent : id,
                    logo: icon ? icon.getAttribute('src') : null
                });
            }
        });

        // Parse programmes
        const programmes = xmlDoc.querySelectorAll('programme');
        programmes.forEach(programme => {
            const channelId = programme.getAttribute('channel');
            if (!channelId) return;

            const start = programme.getAttribute('start');
            const stop = programme.getAttribute('stop');
            const title = programme.querySelector('title');
            const desc = programme.querySelector('desc');
            const category = programme.querySelector('category');
            const icon = programme.querySelector('icon');

            const program = {
                channelId: channelId,
                start: this.parseXMLTVDate(start),
                stop: this.parseXMLTVDate(stop),
                title: title ? title.textContent : 'Unknown',
                description: desc ? desc.textContent : '',
                category: category ? category.textContent : '',
                icon: icon ? icon.getAttribute('src') : null
            };

            if (!this.programs.has(channelId)) {
                this.programs.set(channelId, []);
            }
            this.programs.get(channelId).push(program);
        });

        // Sort programs by start time
        this.programs.forEach((programs, channelId) => {
            programs.sort((a, b) => a.start - b.start);
        });

        return {
            channels: Array.from(this.channelMap.values()),
            programs: Object.fromEntries(this.programs)
        };
    }

    /**
     * Parse XMLTV date format (YYYYMMDDHHmmss +TZ)
     */
    parseXMLTVDate(dateStr) {
        if (!dateStr) return null;
        
        // Format: YYYYMMDDHHmmss or YYYYMMDDHHmmss +TZ
        const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s+([+-]\d{4}))?$/);
        if (!match) return null;

        const [, year, month, day, hour, minute, second, tz] = match;
        const date = new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hour),
            parseInt(minute),
            parseInt(second)
        );

        // Handle timezone offset if present
        if (tz) {
            const tzOffset = parseInt(tz.substring(1, 3)) * 60 + parseInt(tz.substring(3, 5));
            const offsetMinutes = tz.startsWith('+') ? tzOffset : -tzOffset;
            date.setMinutes(date.getMinutes() - date.getTimezoneOffset() - offsetMinutes);
        }

        return date.getTime();
    }

    /**
     * Align EPG with M3U channels
     * @param {Array} m3uChannels - Channels from M3U parser
     * @returns {Map} channelId -> programs mapping
     */
    alignWithChannels(m3uChannels) {
        const aligned = new Map();

        m3uChannels.forEach(channel => {
            const channelId = channel.tvgId || channel.id;
            let programs = [];

            // Try exact match first
            if (this.programs.has(channelId)) {
                programs = this.programs.get(channelId);
            } else {
                // Try fuzzy matching by name
                const matchedChannel = this.findChannelByName(channel.name);
                if (matchedChannel) {
                    programs = this.programs.get(matchedChannel.id) || [];
                }
            }

            if (programs.length > 0) {
                aligned.set(channel.id, programs);
            }
        });

        return aligned;
    }

    /**
     * Find channel by name (fuzzy match) - improved for ESPN and similar channels
     */
    findChannelByName(name) {
        const lowerName = name.toLowerCase().trim();
        // Try exact match first
        for (const [id, channel] of this.channelMap.entries()) {
            const channelLower = channel.name.toLowerCase().trim();
            if (channelLower === lowerName) {
                return { id, ...channel };
            }
        }
        // Try partial matches
        for (const [id, channel] of this.channelMap.entries()) {
            const channelLower = channel.name.toLowerCase().trim();
            // Remove common suffixes/prefixes for better matching
            const cleanName = lowerName.replace(/\s*(hd|us|\.us|network|channel)\s*$/i, '');
            const cleanChannel = channelLower.replace(/\s*(hd|us|\.us|network|channel)\s*$/i, '');
            
            if (cleanName === cleanChannel ||
                channelLower.includes(cleanName) ||
                cleanName.includes(cleanChannel) ||
                // For ESPN, match variations like "ESPN", "ESPN HD", "ESPN US"
                (cleanName.includes('espn') && cleanChannel.includes('espn')) ||
                (cleanName.includes('espn2') && cleanChannel.includes('espn2'))) {
                return { id, ...channel };
            }
        }
        return null;
    }

    /**
     * Get current and upcoming programs for a channel
     * @param {string} channelId - Channel ID
     * @param {number} limit - Maximum number of programs to return
     * @returns {Array} Array of program objects
     */
    getProgramsForChannel(channelId, limit = 10) {
        const programs = this.programs.get(channelId) || [];
        const now = Date.now();
        
        // Filter to current and future programs
        const upcoming = programs.filter(prog => prog.stop >= now);
        
        // Include the current program if it's still playing
        const current = programs.find(prog => prog.start <= now && prog.stop >= now);
        const result = current ? [current, ...upcoming.filter(p => p !== current)] : upcoming;
        
        return result.slice(0, limit);
    }

    /**
     * Format program time for display
     */
    formatProgramTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    /**
     * Get program duration in minutes
     */
    getProgramDuration(program) {
        return Math.round((program.stop - program.start) / (1000 * 60));
    }
}

