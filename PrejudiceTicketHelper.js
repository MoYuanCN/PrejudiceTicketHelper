const axios = require('axios');
const querystring = require('querystring');
const readline = require('readline');
const winston = require('winston');

// 设置日志格式
const logger = winston.createLogger({
    level: 'info', // 设置日志级别为 info，记录 info 及以上级别的日志
    format: winston.format.combine(
        winston.format.timestamp(), // 添加时间戳
        winston.format.printf(({ level, message, timestamp }) => {
            return `${timestamp} ${level}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(), // 输出到控制台
        new winston.transports.File({ filename: 'debug.log' }) // 输出到文件
    ]
});

// BiliRequest 类的实现
class BiliRequest {
    constructor(headers = null) {
        this.session = axios.create();
        this.headers = headers || {
            'accept': '*/*',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6,zh-TW;q=0.5,ja;q=0.4',
            'content-type': 'application/x-www-form-urlencoded',
            'cookie': '', // 这里可以直接设置用户提供的Cookie
            'referer': 'https://show.bilibili.com/',
            'priority': 'u=1, i',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'
        };
    }

    async get(url, data = null) {
        try {
            const response = await this.session.get(url, { params: data, headers: this.headers, timeout: 1000 });
            if (response.status >= 400) {
                throw new Error(`Request failed with status code ${response.status}`);
            }
            const responseData = response.data;
            if (responseData.msg === "请先登录") {
                throw new Error("Cookie已失效，请提供有效的Cookie");
            }
            return responseData;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    async post(url, data = null) {
        try {
            const response = await this.session.post(url, data, { headers: this.headers, timeout: 1000 });
            if (response.status >= 400) {
                throw new Error(`Request failed with status code ${response.status}`);
            }
            const responseData = response.data;
            if (responseData.msg === "请先登录") {
                throw new Error("Cookie已失效，请提供有效的Cookie");
            }
            return responseData;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    async recognizeCaptcha(appkey, gt, challenge, referer, options = {}) {
        const recognizeUrl = 'http://api.rrocr.com/api/recognize.html';
        const requestData = {
            appkey: appkey,
            gt: gt,
            challenge: challenge,
            referer: referer,
            ...options
        };

        try {
            const response = await this.session.post(recognizeUrl, querystring.stringify(requestData), {
                headers: { ...this.headers, 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 60000 // 设置超时时间为60秒
            });

            if (response.status !== 200) {
                throw new Error(`Recognition request failed with status ${response.status}`);
            }

            const responseData = response.data;
            if (responseData.status === 0) {
                logger.info("验证码识别成功:");
                logger.debug(responseData);
                return responseData.data;
            } else {
                throw new Error(`验证码识别失败: ${responseData.msg}`);
            }
        } catch (error) {
            throw new Error(`验证码识别请求失败: ${error.message}`);
        }
    }

    async get_ticket_info(num) {
        try {
            const url = `https://show.bilibili.com/api/ticket/project/getV2?version=134&id=${num}&project_id=${num}`;
            const response = await this.get(url);
            return response;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    async get_buyer_list(project_id) {
        try {
            const url = `https://show.bilibili.com/api/ticket/buyer/list?is_default&projectId=${project_id}`;
            const response = await this.get(url);
            return response;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    async get_address_list() {
        try {
            const url = `https://show.bilibili.com/api/ticket/addr/list`;
            const response = await this.get(url);
            return response;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    async create_order(config_dir) {
        try {
            const url = 'https://show.bilibili.com/api/order/create';
            const response = await this.post(url, config_dir);
            return response;
        } catch (error) {
            throw new Error(error.message);
        }
    }
}

// 示例调用函数
async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('请输入您的Cookie: ', (cookie) => {
        rl.question('请输入您想要抢票的票务ID: ', (ticket_id) => {
            rl.question('请输入您的Appkey: ', (appkey) => {
                processInput(cookie, ticket_id, appkey);
            });
        });
    });

    async function processInput(cookie, ticket_id, appkey) {
        const headers = {
            'cookie': cookie.trim(), // 用户输入的 Cookie
        };

        const biliRequest = new BiliRequest(headers);

        try {
            const ticketDetails = await fetchTicketInfo(biliRequest, ticket_id);
            if (!ticketDetails) {
                console.error("获取票务信息失败。");
                return;
            }

            console.log("获取票务信息成功:");
            console.log("展会名称:", ticketDetails.project_name);
            console.log("开展时间:", ticketDetails.project_start_time, "-", ticketDetails.project_end_time);
            console.log("场馆地址:", ticketDetails.venue_name, ticketDetails.venue_address);

            const buyerAndAddressLists = await fetchBuyerAndAddressLists(biliRequest, ticketDetails.project_id);
            if (!buyerAndAddressLists) {
                console.error("获取购买人信息和地址信息失败。");
                return;
            }

            console.log("已保存的实名信息列表:");
            console.log(buyerAndAddressLists.buyers);
            console.log("已保存的地址信息列表:");
            console.log(buyerAndAddressLists.addresses);

            const selectedTicketIndex = await selectTicket(ticketDetails);
            const selectedBuyerIndices = await selectBuyers(buyerAndAddressLists);

            const orderConfig = buildOrderConfig(ticketDetails, selectedTicketIndex, buyerAndAddressLists, selectedBuyerIndices);

            const captchaDetails = await getCaptchaDetails();
            const captchaResponse = await biliRequest.recognizeCaptcha(appkey, captchaDetails.gt, captchaDetails.challenge, 'https://show.bilibili.com/');

            // 验证码识别成功后的操作，例如将识别结果加入订单配置中
            orderConfig.validate = captchaResponse.validate; // 三代验证码
            // 如果是四代验证码，请根据实际返回结果调整字段，例如:
            // orderConfig.lot_number = captchaResponse.lot_number;
            // orderConfig.pass_token = captchaResponse.pass_token;

            const orderResponse = await biliRequest.create_order(orderConfig);
            console.log("订单创建成功:", orderResponse);

        } catch (error) {
            console.error("操作失败:", error.message);
        } finally {
            rl.close();
        }
    }

    async function fetchTicketInfo(biliRequest, ticket_id) {
        try {
            const response = await biliRequest.get_ticket_info(ticket_id);
            return response.data;
        } catch (error) {
            throw new Error(error.message);
        }
    }

    async function fetchBuyerAndAddressLists(biliRequest, project_id) {
        try {
            const [buyerResponse, addrResponse] = await Promise.all([
                biliRequest.get_buyer_list(project_id),
                biliRequest.get_address_list(),
            ]);

            console.log(biliRequest.get_buyer_list);

            // 检查数据是否为数组，如果不是，则抛出错误
            if (!Array.isArray(buyerResponse.data)) {
                throw new Error("获取的购买人信息不是数组");
            }
            if (!Array.isArray(addrResponse.data)) {
                throw new Error("获取的地址信息不是数组");
            }

            const buyers = buyerResponse.data.map(buyer => ({
                id: buyer.id,
                name: buyer.buyer_name,
                tel: buyer.buyer_phone,
            }));

            const addresses = addrResponse.data.map(addr => ({
                id: addr.id,
                name: addr.name,
                phone: addr.tel,
                addr: addr.addr,
            }));

            return {
                buyers: buyers,
                addresses: addresses,
            };

        } catch (error) {
            throw new Error(error.message);
        }
    }

    async function selectTicket(ticketDetails) {
        // 选择票种的逻辑，根据 ticketDetails 显示票种信息并让用户选择
        // 示例中直接选择第一个票种
        return 0;
    }

    async function selectBuyers(buyerAndAddressLists) {
        // 选择购买人的逻辑，根据 buyerAndAddressLists 显示购买人信息并让用户选择
        // 示例中直接选择第一个购买人
        return [0];
    }

    function buildOrderConfig(ticketDetails, selectedTicketIndex, buyerAndAddressLists, selectedBuyerIndices) {
        const selectedTicket = ticketDetails.screens[0].tickets[selectedTicketIndex];
        const selectedBuyers = selectedBuyerIndices.map(index => buyerAndAddressLists.buyers[index]);
        const selectedAddress = buyerAndAddressLists.addresses[0]; // 假设选择第一个地址

        const configDir = {
            detail: `${ticketDetails.screens[0].name} - ${selectedTicket.desc} - ￥${selectedTicket.price} - ${selectedTicket.sale_flag} - 【起售时间：${selectedTicket.sale_start}】`,
            count: selectedBuyers.length,
            screen_id: ticketDetails.screens[0].id,
            project_id: ticketDetails.project_id,
            sku_id: selectedTicket.id,
            order_type: 1,
            pay_money: selectedTicket.price * selectedBuyers.length,
            buyer_info: selectedBuyers,
            buyer: selectedBuyers.map(buyer => buyer.name).join(', '), // 将所有买家姓名连接为字符串
            tel: selectedBuyers.map(buyer => buyer.tel).join(', '), // 假设每个买家信息中有电话号码字段
            deliver_info: {
                name: selectedAddress.name,
                tel: selectedAddress.phone,
                addr_id: selectedAddress.id,
                addr: selectedAddress.addr,
            },
        };

        if (ticketDetails.require_phone_name) {
            // 如果票务需要通过手机号和姓名创建订单，则添加相关信息
            configDir.phone = selectedBuyers.map(buyer => buyer.tel).join(', ');
            configDir.name = selectedBuyers.map(buyer => buyer.name).join(', ');
        }

        return configDir;
    }

    async function getCaptchaDetails() {
        const url = "https://passport.bilibili.com/x/passport-login/captcha?source=main_web";
        const response = await axios.get(url);
        const captchaData = response.data.data.geetest;
        return {
            gt: captchaData.gt,
            challenge: captchaData.challenge,
        };
    }
}

// 启动主程序
main();
