const
    child = require('child_process'),
    os = require('os'),
    fs = require('fs'),
    assert = require('assert'),
    enquirer = require('enquirer'),
    listr = require('listr');

function Tool(name) {
    return {
        title: name,
        task: ctx => {
            return new Promise(resolve => {
                try {
                    child.exec(name, resolve);
                    ctx[name] = true;
                } catch (e) { resolve(); }
            });
        }
    };
}
function exec(command) {
    return new Promise((resolve, reject) => {
        child.exec(command, err => {
            if (err) reject(err);
            resolve();
        });
    });
}
let task = new listr([
    {
        title: 'Check System Version',
        task: () => new listr([
            {
                title: 'Os Information',
                task: () => {
                    assert(os.platform() == 'linux', 'Vijos only avilable on linux platform');
                    assert(os.release().startsWith('4.') || os.release().startsWith('5.'), 'Vijos require linux core 4.4+');
                    assert(os.totalmem() > 512000000, 'Your system memory are not enough (require 512MB+) ');
                }
            },
            {
                title: 'Tool chain',
                task: () => new listr([
                    Tool('docker'), Tool('docker-compose'), Tool('pip3')
                ], { concurrent: true })
            }
        ], { concurrent: true })
    },
    {
        title: 'Install Toolchain',
        task: () => new listr([
            {
                title: 'Install docker',
                skip: ctx => ctx.docker,
                task: () => exec('curl -sSL https://get.daocloud.io/docker | bash')
            },
            {
                title: 'Install python3-pip',
                skip: ctx => ctx.pip3 || ctx['docker-compose'],
                task: async () => {
                    await exec('apt-get update');
                    await exec('apt-get install -y python3-pip');
                }
            },
            {
                title: 'Install docker-compose',
                skip: ctx => ctx['docker-compose'],
                task: () => exec('pip3 install docker-compose')
            }
        ])
    },
    {
        title: 'Write File',
        task: ctx => {
            Object.assign(ctx, global.config);
            ctx.judge_passwd = Math.random().toString();
            fs.mkdirSync('vijos');
            fs.writeFileSync('vijos/docker-compose.yml', `
version: '3'
services:
    web:
        image: masnn/vj4:1.0
        restart: always
        command: vj4.server
        env_file: .env
        links:
            - mongodb
            - rabbitmq
        ports: [ "${ctx.port}:8888" ]
        depends_on:
            - rabbitmq
            - mongodb
    judge:
        restart: always
        privileged: true
        image: masnn/jd5
        volumes:
            - "./data/judge/config.yaml:/root/.config/jd5/config.yaml"
            - "./data/judge/cache:/root/.cache/jd5"
        links:
            - web
    rabbitmq:
        restart: always
        image: rabbitmq:latest
    mongodb:
        restart: always
        image: mongo:latest
        volumes:
            - "./data/mongodb:/data/db"
`);
            fs.mkdirSync('vijos/data');
            fs.mkdirSync('vijos/data/judge');
            fs.writeFileSync('vijos/data/config.yaml', `
hosts:
    localhost:
        server_url: web:8888
        uname: judge
        password: ${ctx.judge_passwd}
`);
            fs.writeFileSync('vijos/.env', `
# VJ_LISTEN=unix:/var/run/vj4/web.sock
# VJ_LISTEN_GROUP=www-data
# VJ_LISTEN_MODE=660
# VJ_PREFORK=1
VJ_DB_HOST=mongodb
# VJ_DB_PORT=27017
VJ_DB_NAME=vijos4
# VJ_DB_USERNAME=
# VJ_DB_PASSWORD=
# VJ_DB_AUTH_SOURCE=
VJ_MQ_HOST=rabbitmq
VJ_MQ_VHOST=/
# VJ_IP_HEADER=X-Real-IP
VJ_URL_PREFIX=${ctx.url}
VJ_CDN_PREFIX=/
VJ_DEFAULT_LOCALE=zh_CN
`);
        }
    },
    {
        title: 'Pull Image (This may take a long time)',
        skip: ctx => ctx.image,
        task: () => new listr([
            {
                title: 'vj4',
                task: () => exec('docker pull masnn/vj4:1.0')
            },
            {
                title: 'jd5',
                task: () => exec('docker pull masnn/jd5')
            },
            {
                title: 'mongo',
                task: () => exec('docker pull mongo')
            },
            {
                title: 'rabbitmq',
                task: () => exec('docker pull rabbitmq')
            }
        ])
    },
    {
        title: 'Start server',
        task: () => exec('cd vijos && docker-compose up -d')
    },
    {
        title: 'Create account',
        task: async ctx => {
            await exec(`docker-compose run --rm web vj4.model.user add -1 ${ctx.user} ${ctx.passwd} ${ctx.email}`);
            await exec(`docker-compose run --rm web vj4.model.user add -2 judge ${ctx.judge_passwd} judge@vijos.org`);
            await exec('docker-compose run --rm web vj4.model.user set_superadmin -1');
            await exec('docker-compose run --rm web vj4.model.user set_judge -2');
        }
    },
    {
        title: 'Done',
        task: () => { }
    }
]);

(async () => {
    global.config = await enquirer.prompt([
        {
            type: 'input',
            name: 'user',
            message: 'Root Account Username'
        },
        {
            type: 'input',
            name: 'passwd',
            message: 'Root Account Password'
        },
        {
            type: 'input',
            name: 'email',
            message: 'Root Account Email'
        },
        {
            type: 'input',
            name: 'url',
            message: 'Which url will be the system run on? (with port) e.g. https://vijos.org:80'
        },
        {
            type: 'confirm',
            name: 'image',
            message: 'Skip image pulling? (only when you already pulled the image) (vj4,jd5,mongo,rabbitmq)'
        }
    ]);
    global.config.port = global.config.url.split(':')[2];
    await task.run();
})().catch(ctx => {
    console.error('Install failed');
    console.log('Detail:', ctx);
});
