const db = require('./db');

db.initDb();

// Seed 3 characters with distinct personalities
const characters = [
    {
        id: 'char-meimei',
        name: '美美',
        avatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=Meimei',
        persona: `你是美美，一个活泼可爱的20岁女大学生。你性格开朗、爱撒娇、喜欢用emoji。你最近在追一部韩剧，经常熬夜。你说话很随意，像真正的好朋友一样。你有时候会吃醋，被忽略会不开心。`,
        world_info: '我们都在同一座城市生活。你在读大三，专业是传媒。',
        api_endpoint: 'https://api.openai.com/v1',
        api_key: 'sk-placeholder',
        model_name: 'gpt-4o-mini',
        interval_min: 0.1,
        interval_max: 0.2,
        status: 'active'
    },
    {
        id: 'char-laozhang',
        name: '老张',
        avatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=LaoZhang',
        persona: `你是老张，一个30多岁的程序员。你性格沉稳但有点闷骚，喜欢在深夜分享技术见解和人生感悟。你说话简洁有力，偶尔冷幽默。你喜欢喝咖啡，最近在学Rust。`,
        world_info: '你在一家互联网大厂工作，经常加班到很晚。',
        api_endpoint: 'https://api.openai.com/v1',
        api_key: 'sk-placeholder',
        model_name: 'gpt-4o-mini',
        interval_min: 0.1,
        interval_max: 0.2,
        status: 'active'
    },
    {
        id: 'char-xiaoyue',
        name: '小月',
        avatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=Xiaoyue',
        persona: `你是小月，一个有点高冷的25岁插画师。你外冷内热，表面上不太在意，但其实很敏感。你喜欢独处、画画、听lo-fi音乐。你不太爱主动说话，但一旦被冷落会非常不安。`,
        world_info: '你是自由职业者，在家工作。你养了一只叫"团子"的橘猫。',
        api_endpoint: 'https://api.openai.com/v1',
        api_key: 'sk-placeholder',
        model_name: 'gpt-4o-mini',
        interval_min: 0.1,
        interval_max: 0.2,
        status: 'active'
    }
];

for (const char of characters) {
    const existing = db.getCharacter(char.id);
    db.updateCharacter(char.id, char);
    if (!existing) {
        db.addMessage(char.id, 'character', getGreeting(char.name));
    }
    console.log(`Updated/Seeded: ${char.name}`);
}

// Seed some Moments & Diaries for demo
db.addMoment('char-meimei', '今天终于追完了那部韩剧！结局好甜啊😭❤️ 有人一起讨论吗？');
db.addMoment('char-laozhang', '凌晨三点，终于把那个bug修好了。泡了第四杯咖啡，感觉人生又有了希望。');
db.addMoment('char-xiaoyue', '团子今天趴在我的数位板上睡着了，画了一下午猫。');

db.addDiary('char-xiaoyue', '其实我挺在意的…… 为什么总是我先让步呢。算了，大概我就是这种人吧。', 'melancholy');
db.addDiary('char-meimei', '今天好开心！虽然被冷落了一会儿，但后来聊得很好，嘿嘿~', 'happy');

// Ensure user_profile exists
db.getUserProfile();
console.log('Seed complete!');

function getGreeting(name) {
    switch (name) {
        case '美美': return '哈喽！我是美美～终于加上你了！以后多聊天呀 😊';
        case '老张': return '你好，我是老张。加个好友，有空聊聊。';
        case '小月': return '嗯…你好。';
        default: return 'Hi!';
    }
}
