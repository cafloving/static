/**
 * 前端时间处理工具
 * 统一处理UTC时间的显示和转换
 * 
 * 规则：
 * 1. 后端API统一返回UTC时间（ISO 8601格式：YYYY-MM-DDTHH:MM:SSZ）
 * 2. 前端自动根据用户浏览器时区转换显示
 * 3. 前端发送给后端的时间统一转换为UTC格式
 */

const TimeUtils = {
    /**
     * 将UTC时间字符串转换为本地时间字符串（用于显示）
     * @param {string} utcTimeStr - UTC时间字符串 (ISO 8601格式)
     * @param {boolean} showSeconds - 是否显示秒
     * @returns {string} 本地时间字符串
     */
    toLocalTimeString(utcTimeStr, showSeconds = true) {
        if (!utcTimeStr) return '';
        
        try {
            const date = new Date(utcTimeStr);
            if (isNaN(date.getTime())) return utcTimeStr;
            
            const options = {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            };
            
            if (showSeconds) {
                options.second = '2-digit';
            }
            
            return date.toLocaleString('zh-CN', options).replace(/\//g, '-');
        } catch (e) {
            console.error('时间转换失败:', utcTimeStr, e);
            return utcTimeStr;
        }
    },

    /**
     * 将UTC时间字符串转换为相对时间（如"3分钟前"）
     * @param {string} utcTimeStr - UTC时间字符串
     * @returns {string} 相对时间字符串
     */
    toRelativeTime(utcTimeStr) {
        if (!utcTimeStr) return '';
        
        try {
            const date = new Date(utcTimeStr);
            const now = new Date();
            const diffMs = now - date;
            const diffSec = Math.floor(diffMs / 1000);
            const diffMin = Math.floor(diffSec / 60);
            const diffHour = Math.floor(diffMin / 60);
            const diffDay = Math.floor(diffHour / 24);
            
            if (diffSec < 60) return `${diffSec}秒前`;
            if (diffMin < 60) return `${diffMin}分钟前`;
            if (diffHour < 24) return `${diffHour}小时前`;
            if (diffDay < 7) return `${diffDay}天前`;
            
            return this.toLocalTimeString(utcTimeStr, false);
        } catch (e) {
            console.error('相对时间转换失败:', utcTimeStr, e);
            return utcTimeStr;
        }
    },

    /**
     * 将本地时间转换为UTC ISO 8601字符串（用于发送给后端）
     * @param {Date|string} localTime - 本地时间
     * @returns {string} UTC ISO 8601字符串
     */
    toUTCString(localTime) {
        try {
            const date = localTime instanceof Date ? localTime : new Date(localTime);
            if (isNaN(date.getTime())) return '';
            
            return date.toISOString();  // 自动转换为UTC并格式化为ISO 8601
        } catch (e) {
            console.error('UTC转换失败:', localTime, e);
            return '';
        }
    },

    /**
     * 获取当前UTC时间的ISO 8601字符串
     * @returns {string} 当前UTC时间
     */
    nowUTC() {
        return new Date().toISOString();
    },

    /**
     * 格式化日期为 YYYY-MM-DD 格式
     * @param {Date|string} date - 日期
     * @returns {string} YYYY-MM-DD格式的日期字符串
     */
    toDateString(date) {
        try {
            const d = date instanceof Date ? date : new Date(date);
            if (isNaN(d.getTime())) return '';
            
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            
            return `${year}-${month}-${day}`;
        } catch (e) {
            console.error('日期格式化失败:', date, e);
            return '';
        }
    },

    /**
     * 批量转换页面中所有带data-utc-time属性的元素
     * 自动将UTC时间转换为本地时间并显示
     */
    convertAllTimeElements() {
        document.querySelectorAll('[data-utc-time]').forEach(el => {
            const utcTime = el.getAttribute('data-utc-time');
            const showSeconds = el.hasAttribute('data-show-seconds');
            el.textContent = this.toLocalTimeString(utcTime, showSeconds);
        });
    },

    /**
     * 批量转换页面中所有带data-relative-time属性的元素
     * 自动将UTC时间转换为相对时间并显示
     */
    convertAllRelativeTimeElements() {
        document.querySelectorAll('[data-relative-time]').forEach(el => {
            const utcTime = el.getAttribute('data-relative-time');
            el.textContent = this.toRelativeTime(utcTime);
        });
    }
};

// 页面加载完成后自动转换所有时间元素
document.addEventListener('DOMContentLoaded', () => {
    TimeUtils.convertAllTimeElements();
    TimeUtils.convertAllRelativeTimeElements();
    
    // 每30秒更新一次相对时间
    setInterval(() => {
        TimeUtils.convertAllRelativeTimeElements();
    }, 30000);
});

// 导出为全局变量
window.TimeUtils = TimeUtils;
