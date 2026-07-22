// 版本号的唯一权威来源（JS 侧，随每次发布递增）。
// 不用 Constants.expoConfig.version：那是构建时嵌进二进制的静态值，
// 升级安装后才会变；这个文件每次发版随代码更新，显示永远准确。
export const APP_VERSION = '0.10.0';
