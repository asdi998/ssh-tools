import json
import os
import atexit
import shutil
import asyncssh
from fastapi import File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
import uvicorn
import chardet
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from fastapi.staticfiles import StaticFiles


class Settings(BaseModel):
    version: int = 2
    temp_file: str = "uploadfile.tmp"  # 临时文件
    adsl_wait_time: int = 5  # 拨号后等待n秒
    test_adsl_command: int = "command -v pppoe-stop"
    adsl_start_command: int = "pppoe-stop"  # 修改拨号前执行命令
    adsl_secrets_command: int = 'echo "\\"{username}\\"\t*\t\\"{password}\\"" > {file}'
    adsl_conf_command: int = "sed -i 's/USER=.*/USER={user}/' {file}"
    adsl_end_command: int = "pppoe-start"  # 修改拨号后执行命令
    adsl_return_command: int = "ifconfig | grep ppp | grep inet"  # 拨号返回结果命令


class ServerData(BaseModel):
    id: int
    group: str
    vpsname: str
    host: str
    port: int
    passwd: str
    adsl_username: str
    adsl_password: str


class RunRequest(ServerData):
    mode: str
    param: str = None


class CommonRequest(BaseModel):
    type: str
    data: dict


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

    @app.get("/")
    async def index():
        return RedirectResponse("static/index.html")


bgtasks = set()
mySettings = Settings()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global bgtasks
    await websocket.accept()
    await websocket.send_json({"config": {"version": mySettings.version}})
    try:
        while True:
            try:
                data = await websocket.receive_json()
                task = asyncio.create_task(parse_ws_request(data, websocket))
                bgtasks.add(task)
                task.add_done_callback(bgtasks.discard)
            except json.JSONDecodeError as e:
                pass
    except WebSocketDisconnect as e:
        pass


@app.post("/get_file_encoding/")
async def get_file_encoding(file: UploadFile = File(...)):
    contents = await file.read()
    cur_encoding = chardet.detect(contents)["encoding"]
    return {
        "filename": file.filename,
        "encoding": cur_encoding,
        "content": contents.decode(cur_encoding).rstrip(),
    }


@app.post("/upfile/")
async def create_file(filename: str = Form(None), file: UploadFile = File(...)):
    if filename is None:
        filename = mySettings.temp_file
    try:
        with open(filename, "wb") as f:
            shutil.copyfileobj(file.file, f)
        return {"status": "ok", "msg": "上传成功"}
    except Exception as e:
        return {"status": "error", "msg": "上传失败：" + str(e)}


@app.get("/get_settings")
async def get_settings():
    return mySettings


async def parse_ws_request(request, ws: WebSocket):
    global mySettings
    try:
        request = CommonRequest(**request)
        request_type = request.type
        data = request.data
        if request_type == "run":
            try:
                run_request = RunRequest(**data)
                result = await run_client(run_request)
            except Exception as e:
                await ws.send_json(run_return(request, "后端解析异常", stderr=str(e)))
        elif request_type == "set":
            mySettings = Settings(**data)
            result = {"status": "ok"}
        await ws.send_json(result)
    except Exception as e:
        await ws.send_json({"status": "error", "err": str(e)})


async def run_client(request: RunRequest) -> dict:
    try:
        passwd = {"client_keys": None}
        if "|||" in request.passwd:
            key_file = request.passwd.split("|||")
            if os.path.exists(key_file[0]):
                passwd["passphrase"] = key_file[1]
                passwd["client_keys"] = key_file[0]
        elif os.path.exists(request.passwd):
            passwd["client_keys"] = request.passwd
        else:
            passwd["password"] = request.passwd
        if request.mode == "exec":
            if not request.param:
                return run_return(request, "异常", stderr="无命令")
            async with asyncssh.connect(
                request.host,
                port=request.port,
                username="root",
                known_hosts=None,
                **passwd
            ) as conn:
                result = await conn.run(request.param, stdin=asyncssh.DEVNULL)
            return run_return(
                request,
                "执行成功" if result.exit_status == 0 else "执行错误",
                result.exit_status,
                str(result.stdout),
                str(result.stderr),
            )
        elif request.mode == "adsl":
            user_config_file = "/etc/sysconfig/network-scripts/ifcfg-ppp0"
            async with asyncssh.connect(
                request.host,
                port=request.port,
                username="root",
                known_hosts=None,
                **passwd
            ) as conn:
                result = await conn.run(
                    mySettings.test_adsl_command,
                    stdin=asyncssh.DEVNULL,
                )
                if result.exit_status != 0:
                    return run_return(
                        request,
                        "执行错误",
                        result.exit_status,
                        stderr="这台机器似乎不支持此功能",
                    )
                result = await conn.run(
                    'if grep -Eqi "Ubuntu" /etc/issue || grep -Eq "Ubuntu" /etc/*-release; then echo Ubuntu; fi',
                    stdin=asyncssh.DEVNULL,
                )
                isUbuntu = "Ubuntu" in str(result.stdout)
                if isUbuntu:
                    user_config_file = "/etc/ppp/pppoe.conf"
                result = await conn.run(
                    mySettings.adsl_start_command, stdin=asyncssh.DEVNULL
                )
                result = await conn.run(
                    mySettings.adsl_secrets_command.format(
                        username=request.adsl_username,
                        password=request.adsl_password,
                        file="/etc/ppp/chap-secrets",
                    ),
                    stdin=asyncssh.DEVNULL,
                )
                result = await conn.run(
                    mySettings.adsl_secrets_command.format(
                        username=request.adsl_username,
                        password=request.adsl_password,
                        file="/etc/ppp/pap-secrets",
                    ),
                    stdin=asyncssh.DEVNULL,
                )
                result = await conn.run(
                    mySettings.adsl_conf_command.format(
                        user=request.adsl_username, file=user_config_file
                    ),
                    stdin=asyncssh.DEVNULL,
                )
                result = await conn.run(
                    mySettings.adsl_secrets_command.format(
                        username=request.adsl_username,
                        password=request.adsl_password,
                        file="/etc/ppp/pap-secrets",
                    ),
                    stdin=asyncssh.DEVNULL,
                )
                result = await conn.run(
                    mySettings.adsl_end_command, stdin=asyncssh.DEVNULL
                )
                await asyncio.sleep(mySettings.adsl_wait_time)
                result = await conn.run(
                    mySettings.adsl_return_command, stdin=asyncssh.DEVNULL
                )
            return run_return(
                request,
                "执行成功" if result.exit_status == 0 else "执行错误",
                result.exit_status,
                str(result.stdout),
                str(result.stderr),
            )
        elif request.mode == "put":
            async with asyncssh.connect(
                request.host,
                port=request.port,
                username="root",
                known_hosts=None,
                **passwd
            ) as conn:
                async with conn.start_sftp_client() as sftp:
                    await sftp.put(mySettings.temp_file, request.param)
                up_path = os.path.split(request.param)
                result = await conn.run(
                    '{}ls "$PWD/{}"'.format(
                        f"cd {up_path[0]};" if up_path[0] else "",
                        mySettings.temp_file if not up_path[1] else up_path[1],
                    ),
                    stdin=asyncssh.DEVNULL,
                )
            return run_return(
                request,
                "执行成功" if result.exit_status == 0 else "执行错误",
                result.exit_status,
                str(result.stdout),
                str(result.stderr),
            )
    except asyncssh.TimeoutError as e:
        return run_return(request, "SSH异常", stderr="执行超时")
    except asyncssh.SFTPError as e:
        return run_return(request, "SFTP异常", stderr=str(e))
    except asyncssh.Error as e:
        return run_return(request, "SSH异常", stderr=str(e))
    except Exception as e:
        return run_return(request, "未知异常", stderr=str(e))


def run_return(request: RunRequest, status, status_code=-1, stdout="", stderr=""):
    return {
        "id": request.id,
        "status": status,
        "status_code": status_code,
        "stdout": stdout,
        "stderr": stderr,
    }


def clean():
    if os.path.exists(mySettings.temp_file):
        os.remove(mySettings.temp_file)
    if os.path.exists("key"):
        os.remove("key")


if __name__ == "__main__":
    atexit.register(clean)
    uvicorn.run("ssh:app", host="0.0.0.0", port=8000, reload=False)
