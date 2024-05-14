var $ = layui.$;
var tableFilterParam = {}
var upfilename = null
var isUpload = false
var autoRefreshId = null
var isConnected = false
var headerDefault = {
  "group": "产品组",
  "vpsname": "服务器名",
  "passwd": "密码/密钥",
  "host": "ip端口",
  "adsl_username": "拨号账号",
  "adsl_password": "拨号密码"
};
var host = "localhost:8000"
var ws = null
var timeConnect = 0;
var updateCacheDatas = {}
var csvFilename = "导出"
var bgVer = null

const cols = [[ //标题栏
      {type: 'checkbox', fixed: 'left'},
      {field: 'id', title: 'ID', width: 60, sort: true, hide: true},
      {field: 'group', title: '产品组', minWidth: 120, sort: true},
      {field: 'vpsname', title: '服务器名', minWidth: 160, sort: true},
      {field: 'passwd', title: '密码/密钥', minWidth: 120, hide: true},
      {field: 'host', title: 'ip', width: 140},
      {field: 'port', title: '端口', width: 70, hide: true},
      {field: 'adsl_username', title: '拨号账号', minWidth: 130, sort: true, hide: true},
      {field: 'adsl_password', title: '拨号密码', minWidth: 105, sort: true, hide: true},
      {field: 'status', title: '状态', minWidth: 120, sort: true, templet: function(d) {
          if (d.status == '执行中') return '<font color="blue">执行中，等待返回</font>';
          else if (d.status == '执行成功') return '<font color="green">'+d.status+'</font>';
          else if (d.status.indexOf('异常') != -1 || d.status == '执行错误') return '<font color="red">'+d.status+'</font>';
          return d.status;
        }
      },
      {field: 'status_code', title: '状态码', width: 90, sort: true},
      {field: 'stdout', title: '正常输出', minWidth: 100, sort: true, templet: function(d) {
          return d.stdout.replaceAll("\n", "\n<br>");
        }
      },
      {field: 'stderr', title: '错误输出', minWidth: 100, sort: true, templet: function(d) {
          return d.stderr.replaceAll("\n", "\n<br>");
        }
      },
      {field: 'runTime', title: '执行时间', width: 105, sort: true},
      {fixed: 'right', title:'操作', width: 160, toolbar: '#barDemo'}
    ]];

var servers = {
  header: null,
  data: null
};
const groups = new Set();

layui.use(function () {
  var $ = layui.$;
  var layer = layui.layer;
  var form = layui.form;
  var util = layui.util;
  var upload = layui.upload;
  var table = layui.table;

  layer.prompt({
    title: '请输入后端地址',
    value: host
  }, function (text, index) {
    layer.close(index)
    host = text
    ws_init()
  });

  $("#downBG").click(function () {
    window.open("/sshtool/sshpy/1/ssh.py");
  })
  $("#downFG").click(function () {
    window.open("/sshtool/package/1/static.zip");
  })
  // 渲染
  upload.render({
    elem: '#csv_file', // 绑定多个元素
    url: 'http://' + host + '/get_file_encoding/', // 此处配置你自己的上传接口即可
    acceptMime: 'text/csv',
    before: function (obj) {
      return checkConnected()
    },
    done: function (res) {
      csvFilename = res.filename.split(".")[0]
      ret = Papa.parse(res.content, {
        header: true,
      });
      servers.header = ret.meta.fields
      servers.data = ret.data
      csvFieldSetting(servers.header)
    }
  });
  upload.render({
    elem: '#tempfile', // 绑定多个元素
    url: 'http://' + host + '/upfile/', // 此处配置你自己的上传接口即可
    choose: function (obj) {
      obj.preview(function (index, file, result) {
        upfilename = file.name
        $('#upfileTip').text("已上传文件：" + file.name + " (" + file.sizes + "）")
        $('#upfileTip').hide()
      })
    },
    before: function (obj) {
      return checkConnected()
    },
    done: function (res) {
      isUpload = true
      $('#upfileTip').show()
      layer.msg(res['msg']);
    }
  });

  //右侧工具栏
  table.on('tool(currentTableFilter)', function (obj) {
    if (obj.event === 'exec') { // 监听添加操作
      layer.prompt({
        title: '请输入需要执行的命令',
        formType: 2
      }, function (text, index) {
        layer.close(index);
        runCommand(obj.data, text)
      });
    } else if (obj.event === 'upfile') { // 监听添加操作
      if (!isUpload) {
        layer.msg("请先上传临时文件到后端服务器")
        return
      }
      layer.prompt({
        title: '请输入要上传的文件路径',
        value: upfilename
      }, function (text, index) {
        layer.close(index);
        putFile(obj.data, text)
      });
    } else if (obj.event === 'adsl') { // 监听添加操作
      layer.confirm("是否执行？", {}, function (index) {
        layer.close(index);
        reADSL(obj.data)
      });
    }
  });

  //上方工具栏
  table.on('toolbar(currentTableFilter)', function (obj) {
    var id = obj.config.id;
    var checkStatus = table.checkStatus(id);
    var othis = lay(this);
    let ids = []
    for (let a of checkStatus.data) {
      ids.push(a.id)
    }
    switch (obj.event) {
      case 'runCommand':
        if (checkStatus.data.length != 0) {
          layer.prompt({
            title: '请输入需要执行的命令',
            formType: 2
          }, function (command, index) {
            layer.close(index);
            setTimeout(() => runCommands(command), 100)
          });
        } else {
          layer.alert("请选中要执行的服务器")
        }
        break;
      case 'putFile':
        if (!isUpload) {
          layer.msg("请先上传临时文件到后端服务器")
          return
        }
        if (ids.length != 0) {
          layer.prompt({
            title: '请输入要上传的文件路径',
            value: upfilename
          }, function (path, index) {
            layer.close(index);
            setTimeout(() => putFiles(path), 100)
          });
        } else {
          layer.alert("请选中要上传的服务器")
        }
        break;
      case 'reADSL':
        if (ids.length != 0) {
          layer.confirm("是否执行？", {}, function (index) {
            layer.close(index);
            setTimeout(() => reADSLs(), 100)
          });
        } else {
          layer.alert("请选中要执行的服务器")
        }
        break;
      case 'refresh':
        renderTable()
        break;
      case 'LAYTABLE_EXPORT':
        table.exportFile('serversTable', undefined, {
          type: 'xls', // 导出的文件格式，支持: csv,xls
          title: csvFilename + formatDateTime(new Date(), "_yyyy-MM-dd_HH:mm:ss")
        });
        break;
    };
  });

});

function formatDateTime(date, format) {
  const o = {
    'M+': date.getMonth() + 1, // 月份
    'd+': date.getDate(), // 日
    'h+': date.getHours() % 12 === 0 ? 12 : date.getHours() % 12, // 小时
    'H+': date.getHours(), // 小时
    'm+': date.getMinutes(), // 分
    's+': date.getSeconds(), // 秒
    'q+': Math.floor((date.getMonth() + 3) / 3), // 季度
    S: date.getMilliseconds(), // 毫秒
    a: date.getHours() < 12 ? '上午' : '下午', // 上午/下午
    A: date.getHours() < 12 ? 'AM' : 'PM', // AM/PM
  };
  if (/(y+)/.test(format)) {
    format = format.replace(RegExp.$1, (date.getFullYear() + '').substr(4 - RegExp.$1.length));
  }
  for (let k in o) {
    if (new RegExp('(' + k + ')').test(format)) {
      format = format.replace(
        RegExp.$1,
        RegExp.$1.length === 1 ? o[k] : ('00' + o[k]).substr(('' + o[k]).length)
      );
    }
  }
  return format;
}

function checkConnected() {
  if (!isConnected) {
    layer.alert("已与后端断开连接，请刷新网页")
    return false
  }
  return true
}

function ws_init() {
  ws = new WebSocket("ws://" + host + "/ws");
  ws.onmessage = function (event) {
    try {
      response = JSON.parse(event.data);
      parseResponse(response)
      return true;
    } catch (error) {
      return false;
    }
  };

  ws.onopen = function () {
    isConnected = true
    layer.msg('已连接到后端', {
      icon: 6
    });
  }
  ws.onclose = function () {
    if (isConnected) {
      isConnected = false
      layer.alert("已与后端断开连接，尝试自动重连")
      ws_reconnect();
    }
  }
  ws.onerror = function () {
    if (isConnected) {
      isConnected = false
      layer.alert("已与后端断开连接，尝试自动重连")
      ws_reconnect();
    }
  }
}

function ws_reconnect() {
  timeConnect++;
  console.log("WS第" + timeConnect + "次重连");
  setTimeout(function () {
    ws_init();
  }, 1000);

}

function sendJson(data) {
  if (checkConnected()) {
    ws.send(JSON.stringify(data));
  }
}

function parseResponse(ret) {
  if (ret.id !== undefined && ret.status != undefined) {
    updateCache(ret.id, ret)
  } else if (ret.config !== undefined) {
    if (ret.config.version !== undefined) {
      bgVer = ret.config.version
      layer.msg("后端版本：" + bgVer)
    }
  }
}




function csvFieldSetting(headers) {
  let selectContent = '';
  for (let i in headers) {
    selectContent += '<option value="' + i + '">' + headers[i] + '</option>';
  }
  const formList = []
  for (let key in headerDefault) {
    formList.push([headerDefault[key], `
                      <select name="` + key + `" required lay-verify="required">
                          ` + selectContent + `
                      </select>
      `])
  }
  formList.push(['', '<button class="layui-btn" lay-submit lay-filter="sub">提交</button>'])
  let htmlContent = '';
  formList.forEach(function (curr, index, arr) {
    htmlContent += `
              <div class="layui-form-item">
                  <label class="layui-form-label">` + curr[0] + `</label>
                  <div class="layui-input-block">
                      ` + curr[1] + `
                  </div>
              </div>
              `;
  });
  layer.closeAll('page');
  layer.open({
    type: 1,
    maxmin: true,
    resize: false,
    shadeClose: true,
    title: '字段选择',
    content: `
          <form id="editForm" class="layui-form" action="" enctype="multipart/form-data" lay-filter="editForm" onsubmit="return false">
          ` + htmlContent + `
          </form>
          `,
    success: function (index) {
      let form = layui.form;
      let $ = layui.$;
      let table = layui.table;
      form.render();
      form.val('editForm', {
        'vpsname': 2,
        'group': 1,
        'host': 4,
        'passwd': 3,
        'adsl_username': 5,
        'adsl_password': 5
      })
      form.on('submit(sub)', function (data) {
        tranServers(data.field)
        layer.closeAll('page');
        return false;
      });
    }
  });
}

function tranServers(fieldMaps) {
  groups.clear()
  let newServers = {
    header: [
      ["id", "ID"]
    ],
    data: []
  }
  for (let key in headerDefault) {
    newServers.header.push([key, headerDefault[key]])
  }
  for (let i = 0; i < servers.data.length; i++) {
    let d = {
      id: i,
      status: "未操作",
      status_code: 0,
      stdout: "",
      stderr: "",
      runTime: ""
    }
    for (let key in headerDefault) {
      if (key == "host") {
        let ipp = matchIPPort(servers.data[i][servers.header[fieldMaps[key]]])
        if (ipp !== false) {
          d['host'] = ipp['ip']
          d['port'] = ipp['port']
          continue
        }
      } else if (key == "adsl_username" || key == "adsl_password") {
        let adsl = matchADSL(servers.data[i][servers.header[fieldMaps[key]]])
        if (adsl !== false) {
          d['adsl_username'] = adsl['username']
          d['adsl_password'] = adsl['password']
          continue
        }
      } else if (key == "group") {
        groups.add(servers.data[i][servers.header[fieldMaps[key]]])
      }
      d[key] = servers.data[i][servers.header[fieldMaps[key]]]
    }
    newServers.data.push(d)
  }
  servers = newServers
  layui.table.render({
    elem: "#serversTable",
    cols: cols,
    data: servers.data,
    toolbar: '#toolbarDemo',
    defaultToolbar: ['filter', {
      title: '导出',
      layEvent: 'LAYTABLE_EXPORT',
      icon: 'layui-icon-export'
    }],
    lineStyle: 'height: 95px;',
    done: function () {
      let id = this.id;
      // 下拉按钮测试
      let ddbData = [{
        id: "",
        title: "全部"
      }]
      for (let g of groups) {
        ddbData.push({
          id: g,
          title: g
        })
      }
      layui.dropdown.render({
        elem: '#filterGroupButton', // 可绑定在任意元素中，此处以上述按钮为例
        data: ddbData,
        // 菜单被点击的事件
        click: function (obj) {
          showGroup(obj.id)
        }
      });
      layui.dropdown.render({
        elem: '#filterStatusButton', // 可绑定在任意元素中，此处以上述按钮为例
        data: [{
          id: "",
          title: "全部"
        }, {
          id: "no",
          title: "未操作"
        }, {
          id: "ing",
          title: "执行中"
        }, {
          id: "ok",
          title: "执行成功"
        }, {
          id: "fail",
          title: "执行错误"
        }, {
          id: "err",
          title: "异常"
        }, {
          id: "fe",
          title: "错误+异常"
        }],
        // 菜单被点击的事件
        click: function (obj) {
          showStatus(obj.id)
        }
      });
    }
  })
}

function reADSLs() {
  let datas = layui.table.checkStatus('serversTable').data
  for (let data of datas) {
    reADSL(data)
  }
}


function runCommands(command) {
  let datas = layui.table.checkStatus('serversTable').data
  for (let data of datas) {
    runCommand(data, command)
  }
}

function putFiles(path) {
  let datas = layui.table.checkStatus('serversTable').data
  for (let data of datas) {
    putFile(data, path)
  }
}

function runCommand(data, command) {
  requestServerWs(data, "exec", command)
}

function reADSL(data) {
  requestServerWs(data, "adsl", "")
}

function putFile(data, path) {
  requestServerWs(data, "put", path)
}

function requestServerWs(data, mode, param) {
  if (!checkConnected()) {
    return
  }
  data = {
    id: data.id,
    group: data.group,
    vpsname: data.vpsname,
    host: data.host,
    port: data.port,
    passwd: data.passwd,
    adsl_username: data.adsl_username,
    adsl_password: data.adsl_password,
    mode: mode,
    param: param
  }
  updateCache(data.id, {
    status: "执行中",
    startTime: performance.now()
  })
  sendJson(data)
}

function updateCache(id, data) {
  let t = layui.table.cache['serversTable']
  for (let i = 0, len = t.length; i < len; i++) {
    let d = t[i]
    if (d['id'] == id) {
      Object.assign(d, data)
      if (d.startTime != undefined && data.startTime == undefined) {
        d.runTime = parseInt(performance.now() - d.startTime) + "ms";
      }
      updateCacheDatas[id] = d
      break
    }
  }
  layui.table.renderData('serversTable')
}

function renderTable() {
  let checkedIds = []
  for (let s of layui.table.checkStatus('serversTable').data) {
    checkedIds.push(s['id'])
  }
  for (let k in updateCacheDatas) {
    servers.data[k] = updateCacheDatas[k]
  }
  layui.table.reloadData("serversTable", {
    data: servers.data
  }, true);
  for (let k in tableFilterParam) {
    layui.table.cache['serversTable'] = layui.table.cache['serversTable'].filter(item => {
      if (k == "status") {
        if (Array.isArray(tableFilterParam[k])) {
          for (let elem of tableFilterParam[k]) {
            if (item[k].indexOf(elem) !== -1) {
              return true
            }
          }
          return false
        } else {
          return (item[k].indexOf(tableFilterParam[k]) !== -1)
        }
      } else {
        return item[k] == tableFilterParam[k]
      }
    });
  }
  let t = layui.table.cache['serversTable']
  for (let i = 0, len = t.length; i < len; i++) {
    let d = t[i]
    d['LAY_CHECKED'] = checkedIds.includes(d['id'])
  }
  layui.table.renderData('serversTable')
}

function renderData() {
  layui.table.renderData('serversTable')
}

function matchIPPort(host) {
  let p = /(.*):(\d*)/
  let result = host.match(p)
  if (!result || result.length != 3) return {
    ip: host,
    port: 22
  }
  return {
    ip: result[1],
    port: result[2]
  }
}

function matchADSL(adsl) {
  let p = /[(]([^ ]*)[ ]*([^ ]*)[)]/
  let result = adsl.match(p)
  if (result.length != 3) return false
  return {
    username: result[1],
    password: result[2]
  }
}

function showGroup(group) {
  if (group) {
    tableFilterParam['group'] = group
  } else if (tableFilterParam['group']) {
    delete tableFilterParam['group']
  }
  renderTable()
}

function showStatus(status) {
  if (status) {
    if (status == 'ok') tableFilterParam['status'] = "成功"
    else if (status == 'no') tableFilterParam['status'] = "未操作"
    else if (status == 'err') tableFilterParam['status'] = "异常"
    else if (status == 'fail') tableFilterParam['status'] = "错误"
    else if (status == 'ing') tableFilterParam['status'] = "执行中"
    else if (status == 'fe') tableFilterParam['status'] = ["错误", "异常"]
  } else if (tableFilterParam['status']) {
    delete tableFilterParam['status']
  }
  renderTable()
}

String.prototype.replaceAll = function(s1,s2){
  return this.replace(new RegExp(s1,"gm"),s2);
}