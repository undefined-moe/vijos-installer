const
    child = require('child_process'),
    os = require('os'),
    fs = require('fs'),
    assert = require('assert'),
    enquirer = require('enquirer'),
    listr = require('listr'),
    exec = command => new Promise((resolve, reject) => {
        child.exec(command, err => {
            if (err) reject(err);
            resolve();
        });
    }),
    Image = id => ({
        title: id,
        task: () => exec(`docker pull ${id}`)
    }),
    Tool = name => ({
        title: name,
        task: ctx => new Promise(resolve => {
            child.exec(name + ' --help', err => {
                if (!err) ctx[name] = true;
                resolve();
            });
        })
    });
String.prototype.format = function(args) {
    let result = this;
    if (arguments.length > 0) {
        if (arguments.length == 1 && typeof (args) == "object") {
            for (var key in args) {
                if(args[key]!=undefined){
                    var reg = new RegExp("({" + key + "})", "g");
                    result = result.replace(reg, args[key]);
                }
            }
        } else {
            for (var i = 0; i < arguments.length; i++) {
                if (arguments[i] != undefined) {
                    var reg= new RegExp("({)" + i + "(})", "g");
                    result = result.replace(reg, arguments[i]);
                }
            }
        }
    }
    return result;
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
            fs.writeFileSync('vijos/docker-compose.yml', fs.readFileSync('./docker-compose.yml').toString().format(ctx));
            fs.mkdirSync('vijos/data');
            fs.mkdirSync('vijos/data/judge');
            fs.writeFileSync('vijos/data/judge/config.yaml', fs.readFileSync('./config.yaml').toString().format(ctx));
            fs.writeFileSync('vijos/.env', fs.readFileSync('./.env').toString().format(ctx));
        }
    },
    {
        title: 'Pull Image (This may take a long time)',
        task: () => new listr([
            Image('masnn/vj4'), Image('masnn/jd5'), Image('mongo'), Image('rabbitmq')
        ])
    },
    {
        title: 'Start server',
        task: () => exec('cd vijos && docker-compose up -d')
    },
    {
        title: 'Create account',
        task: async ctx => {
            await exec(`cd vijos && docker-compose run --rm web vj4.model.user add -1 ${ctx.user} ${ctx.passwd} ${ctx.email}`);
            await exec(`cd vijos && docker-compose run --rm web vj4.model.user add -2 judge ${ctx.judge_passwd} judge@vijos.org`);
            await exec('cd vijos && docker-compose run --rm web vj4.model.user set_superadmin -1');
            await exec('cd vijos && docker-compose run --rm web vj4.model.user set_judge -2');
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
            message: 'Root Account Username',
            validate: value => /[^\s\u3000](.{,254}[^\s\u3000])?/i.test(value)
        },
        {
            type: 'input',
            name: 'passwd',
            message: 'Root Account Password',
            validate: value => value.length >= 5
        },
        {
            type: 'input',
            name: 'email',
            message: 'Root Account Email',
            validate: value => {
                const RE_MAIL = /^.+@.+\..+$/i;
                return RE_MAIL.test(value);
            }
        },
        {
            type: 'input',
            name: 'url',
            message: 'Which url will be the system run on? (with port) e.g. https://vijos.org:80',
            validate: value => {
                const RE_URL = /^https?:\/\/.+:[0-9]+$/i;
                return RE_URL.test(value);
            }
        },
        {
            type: 'input',
            name: 'smtp_host',
            message: 'SMTP mail server host e.g. smtp.qq.com'
        },
        {
            type: 'input',
            name: 'smtp_user',
            message: 'SMTP mail server user e.g. account@vijos.org',
            validate: value => {
                const RE_MAIL = /^.+@.+\..+$/i;
                return RE_MAIL.test(value);
            }
        },
        {
            type: 'input',
            name: 'smtp_passwd',
            message: 'SMTP mail server password'
        },
        {
            type: 'input',
            name: 'smtp_port',
            message: 'SMTP mail server port (maybe 465 or 587)'
        }
    ]);
    global.config.port = global.config.url.split(':')[2];
    await task.run();
})().catch(ctx => {
    console.error('Install failed');
    console.log('Detail:', ctx);
});
