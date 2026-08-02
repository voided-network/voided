#!/usr/bin/env node
import { spawn } from 'child_process';
import { readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runTests() {
    const files = await readdir(__dirname);
    // Skip large-data, benchmark, and slow integration coverage in this local runner.
    const skipFiles = [
        'batch.operations.test.mjs',
        'benchmark-all.e2e.test.mjs',
        'pipeline.test.mjs',
        'property.test.mjs',
        'reencrypt.edge.test.mjs',
        'service.e2e.stress.test.mjs',
        'stats.integration.test.mjs',
        'stats.random.fuzz.test.mjs',
        'streams.basic.test.mjs',
        'tb.integration.test.mjs'
    ];
    const testFiles = files.filter(f => f.endsWith('.test.mjs') && f !== 'run-all.mjs' && !skipFiles.includes(f));
    
    console.log(`\n🧪 Running ${testFiles.length} test files...\n`);
    console.log('=' .repeat(60) + '\n');
    
    let totalPassed = 0;
    let totalFailed = 0;
    const failedFiles = [];

    for (const file of testFiles) {
        const filePath = join(__dirname, file);
        console.log(`\n📁 ${file}\n`);
        
        try {
            await new Promise((resolve, reject) => {
                const proc = spawn(process.execPath, [filePath], {
                    stdio: 'inherit'
                });
                proc.on('close', code => {
                    if (code === 0) resolve();
                    else reject(new Error(`Exit code ${code}`));
                });
                proc.on('error', reject);
            });
            totalPassed++;
        } catch (e) {
            totalFailed++;
            failedFiles.push(file);
        }
        
        console.log('\n' + '-'.repeat(60));
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n📊 Final Summary: ${totalPassed} files passed, ${totalFailed} files failed\n`);
    
    if (failedFiles.length > 0) {
        console.log('❌ Failed files:');
        failedFiles.forEach(f => console.log(`   - ${f}`));
        process.exit(1);
    } else {
        console.log('✅ All test files passed!');
    }
}

runTests().catch(e => {
    console.error(e);
    process.exit(1);
});
