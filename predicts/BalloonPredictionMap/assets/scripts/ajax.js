const AJAX = {
    get: function (url, data, callback, async) {
        let query = [];

        for (let key in data) {
            query.push(encodeURIComponent(key) + '=' + encodeURIComponent(data[key]));
        }

        AJAX.send(url + (query.length > 0 ? '?' + query.join('&') : ''), callback, 'GET', null, async);
    }, post: function (url, data, callback, async) {
        let query = [];

        for (let key in data) {
            query.push(encodeURIComponent(key) + '=' + encodeURIComponent(data[key]));
        }

        AJAX.send(url, callback, 'POST', query.join('&'), async);
    }, send: function (url, callback, method, data, async) {
        if (async === undefined) {
            async = true;
        }

        let xml_http_request;

        if (typeof XMLHttpRequest !== 'undefined') {
            xml_http_request = new XMLHttpRequest();
        } else {
            for (let version of ['MSXML2.XmlHttp.6.0', 'MSXML2.XmlHttp.5.0', ' MSXML2.XmlHttp.4.0', 'MSXML2.XmlHttp.3.0', 'MSXML2.XmlHttp.2.0', 'Microsoft.XmlHttp']) {
                try {
                    xml_http_request = new ActiveXObject(version);
                    break;
                } catch (error) {
                    console.log(version + ': ' + error);
                }
            }
        }

        xml_http_request.open(method, url, async);
        xml_http_request.onreadystatechange = function () {
            if (xml_http_request.readyState === 4) {
                callback(JSON.parse(xml_http_request.responseText));
            }
        };

        if (method === 'POST') {
            xml_http_request.setRequestHeader('Content-type', 'application/x-docs-form-urlencoded');
        }

        xml_http_request.send(data);
    }
};