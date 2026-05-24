export interface ProxyConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
}

export class ProxyManager {
    private proxies: ProxyConfig[] = [];
    private currentIndex = 0;

    constructor(proxyStrings: string[]) {
        this.proxies = proxyStrings.map(str => this.parseProxyString(str)).filter(p => p !== null) as ProxyConfig[];
    }

    private parseProxyString(str: string): ProxyConfig | null {
        // Expected format: host:port or host:port:user:pass
        const parts = str.split(':');
        if (parts.length >= 2) {
            return {
                host: parts[0],
                port: parseInt(parts[1]),
                username: parts[2] || undefined,
                password: parts[3] || undefined
            };
        }
        return null;
    }

    getNextProxy(): ProxyConfig | undefined {
        if (this.proxies.length === 0) return undefined;
        const proxy = this.proxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return proxy;
    }

    hasProxies(): boolean {
        return this.proxies.length > 0;
    }
}
