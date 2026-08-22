export interface TermInfo {
  title: string;
  desc: string;
}

export const TERM_TIPS: Record<string, TermInfo> = {
  private_key: {
    title: "私钥",
    desc: "生成的一串字符密钥，是这个钱包资产的唯一所有权凭证；一旦泄露，钱包里的资产就会丢失，请务必妥善保管。",
  },
  vanity: {
    title: "靓号地址",
    desc: "指具有特定视觉规律（如 0xAAAA…、…8888）的地址，通过大量随机尝试自动筛选出符合你偏好的地址。",
  },
  expected_difficulty: {
    title: "预期难度",
    desc: "按概率平均，找到你想要的地址样式需要的尝试次数。匹配字符越多越难（例如 8 位字符约 43 亿次），时间也越长。",
  },
  performance_mode: {
    title: "性能模式",
    desc: "控制电脑的计算强度：省电 = 让一半核心工作；均衡 = 推荐方案，留一个核心给系统用；狂暴 = 全力搜索，风扇会明显加速、耗电更快。",
  },
  worker_threads: {
    title: "计算通道数",
    desc: "同时参与搜索靓号地址的计算通道，越多通常越快，但占用电性能量也越大。",
  },
  keystore_v3: {
    title: "加密钱包文件",
    desc: "以太坊通用的加密钱包文件格式，设置独立导出密码后，文件可直接导入主流钱包 App（例如 MetaMask、imToken）使用。",
  },
  argon2id: {
    title: "主密码加密方式",
    desc: "业界推荐的防破解主密码加密方式（抗暴力破解），由你的主密码推导出本地钱包库的加密钥匙。",
  },
  master_password: {
    title: "主密码",
    desc: "本地钱包库的唯一入口密码，每次保存或查看私钥都会用到；它不存在任何服务器上，一旦丢失无法通过客服找回。",
  },
  regex: {
    title: "自定义规则匹配",
    desc: "表达灵活，但搜索速度会变慢，只有在简单的前缀后缀组合满足不了你的要求时才建议使用。",
  },
  address_prefix: {
    title: "地址前缀匹配",
    desc: "以太坊地址以 0x 开头，前缀匹配指的是 0x 后面的字符。",
  },
  secp256k1: {
    title: "公私钥生成算法",
    desc: "生成以太坊公钥私钥对的数学基础，是所有主流区块链地址的通用标准。",
  },
  keccak256: {
    title: "地址推导算法",
    desc: "由公钥推导地址的加密计算步骤，最终取计算结果的最后 20 个字节就是你的钱包地址。",
  },
  task_status_running: {
    title: "运行中状态",
    desc: "正在搜索中：程序会不停尝试随机私钥并检查地址是否符合你的条件，此阶段 CPU 占比较高、风扇加速属于正常现象。",
  },
};
