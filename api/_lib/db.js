import mysql from 'mysql2/promise';

/**
 * 数据库连接池 — 单例
 *
 * 环境变量:
 *   DB_HOST     腾讯云 MySQL 地址 (e.g. "cdb-xxx.hk.tencentcdb.com")
 *   DB_PORT     端口 (默认 3306)
 *   DB_USER     用户名
 *   DB_PASS     密码
 *   DB_NAME     数据库名 (默认 "maanshan")
 *
 * 如果环境变量未配置，所有 db 操作静默跳过（返回空数据），
 * 前端 localStorage 仍然保存数据不会丢失。
 */

let pool = null;

function getPool() {
  if (pool) return pool;
  const host = process.env.DB_HOST;
  if (!host) return null; // 未配置，静默降级
  pool = mysql.createPool({
    host,
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'maanshan',
    waitForConnections: true,
    connectionLimit: 5,       // serverless 环境不宜太多
    queueLimit: 0,
    connectTimeout: 5000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  });
  return pool;
}

/**
 * 执行查询，失败返回 null（不抛异常，让调用方降级）
 */
export async function query(sql, params = []) {
  const p = getPool();
  if (!p) return null;
  try {
    const [rows] = await p.execute(sql, params);
    return rows;
  } catch (err) {
    console.error('DB query error:', err.message);
    return null;
  }
}

/**
 * 执行写入，失败返回 false
 */
export async function execute(sql, params = []) {
  const p = getPool();
  if (!p) return false;
  try {
    const [result] = await p.execute(sql, params);
    return result;
  } catch (err) {
    console.error('DB execute error:', err.message);
    return false;
  }
}

/**
 * 检查数据库是否可用
 */
export function isDbReady() {
  return !!getPool();
}

/**
 * 建表 SQL（首次部署运行一次即可）
 */
export const INIT_SQL = `
CREATE TABLE IF NOT EXISTS student_data (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  student_id  VARCHAR(32)  NOT NULL,
  name        VARCHAR(64)  DEFAULT '',
  grade       TINYINT      NOT NULL,
  cls         CHAR(1)      NOT NULL,
  poem_id     TINYINT      NOT NULL,
  section     ENUM('reading','writing','report') NOT NULL,
  payload     JSON         NOT NULL,
  sync_id     VARCHAR(64)  DEFAULT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY  uk_sync (sync_id),
  KEY         idx_class_poem (grade, cls, poem_id),
  KEY         idx_student_poem (student_id, poem_id, section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;
