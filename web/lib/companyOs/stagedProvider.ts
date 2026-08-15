import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";

export function isStagedLoopbackUrl(url:URL):boolean {
  const loopback=url.hostname==="127.0.0.1"||url.hostname==="localhost"||url.hostname==="[::1]";
  return process.env.NODE_ENV!=="production"&&process.env.FAIVR_STAGED_LOCAL_PROVIDERS==="1"&&url.protocol==="https:"&&loopback;
}

export function requireStagedLoopbackUrl(url:URL):void {
  if(!isStagedLoopbackUrl(url)||url.username||url.password||url.hash)throw new Error("staged_provider_origin_not_allowed");
}

export async function stagedProviderRequest(input:{url:URL;method?:string;headers?:Record<string,string>;body?:string|Buffer;maxBytes?:number}) {
  requireStagedLoopbackUrl(input.url);
  const caPath=process.env.FAIVR_STAGED_PROVIDER_CA_PATH?.trim();
  if(!caPath)throw new Error("staged_provider_ca_not_configured");
  const ca=await readFile(caPath),body=input.body??Buffer.alloc(0),bodyLength=Buffer.byteLength(body),maxBytes=input.maxBytes??1024*1024;
  const headers={...(input.headers??{}),...(bodyLength?{"Content-Length":String(bodyLength)}:{})};
  return new Promise<{status:number;headers:Record<string,string>;body:Buffer}>((resolve,reject)=>{
    const request=httpsRequest(input.url,{method:input.method??"GET",headers,ca,rejectUnauthorized:true},response=>{
      const chunks:Buffer[]=[];let length=0;
      response.on("data",chunk=>{const value=Buffer.from(chunk);length+=value.length;if(length>maxBytes){request.destroy(new Error("staged_provider_response_too_large"));return;}chunks.push(value);});
      response.on("end",()=>{const normalized:Record<string,string>={};for(const [key,value] of Object.entries(response.headers)){if(typeof value==="string")normalized[key]=value;else if(Array.isArray(value))normalized[key]=value.join(",");}resolve({status:response.statusCode??502,headers:normalized,body:Buffer.concat(chunks)});});
    });
    request.on("error",reject);
    if(bodyLength)request.write(body);
    request.end();
  });
}
