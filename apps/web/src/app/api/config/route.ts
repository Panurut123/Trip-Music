import { NextResponse } from "next/server";
export function GET(){ return NextResponse.json({developerName:process.env.DEVELOPER_NAME||"Trip Music",demoMode:process.env.DEMO_MODE === "true"}); }
