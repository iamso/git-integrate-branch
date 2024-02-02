#!/usr/bin/env node

const { promisify } = require('util')
const exec = promisify(require('child_process').exec)
const prompts = require('prompts')
const kleur = require('kleur')

async function run () {
  const origin = 'origin'

  // exit if this is not a git repo
  try {
    await exec('git rev-parse --git-dir > /dev/null 2>&1')
  } catch(err) {
    logError('Not a git repo')
    process.exit(1)
  }

  // check if the working copy is dirty
  try {
    const { stdout } = await exec('git diff --shortstat')
    if (stdout) {
      throw new Error()
    }
  } catch(err) {
    logError('Working copy is not clean')
    process.exit(1)
  }

  // fetching from remote
  try {
    await exec(`git fetch ${origin} --tags`)
  } catch(err) {
    logError('Error fetching remote')
    console.error(err)
    process.exit(1)
  }

  // get branches
  const { stdout: branches } = await exec('git branch -v --sort=-committerdate')
  const choices = branches
    .split(/\n/)
    .filter(branch => !!branch.trim())
    .map(branch => {
      const [, flag, value, hint] = branch.match(/([* ]) +([^ ]+) +(.+)/)
      return { value, hint, disabled: flag === '*' }
    })

  // exit if there isn't more than 1 branch
  if (choices.length <= 1) {
    logError('No branches to integrate')
    process.exit(1)
  }

  // select source branch
  const { sourceBranch } = await prompts({
    type: 'select',
    name: 'sourceBranch',
    message: 'Integrate branch',
    choices,
    hint: choices[0].hint,
    warn: 'current branch',
    onState (state) {
      this.hint = choices.find(c => c.value === state.value).hint
      onAbort(state)
    }
  })

  // confirm the source branch
  const { confirm } = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: `Do you really want to integrate ${sourceBranch}`,
    initial: false,
    onState: onAbort
  })

  if (!confirm) {
    logSuccess('Ok whatever ¯\\_(ツ)_/¯', true)
    process.exit(0)
  }

  const targetBranch = choices.find(b => b.disabled)?.value
  const targetBranchRemote = `${origin}/${targetBranch}`
  const sourceBranchRemote = `${origin}/${sourceBranch}`
  const integratedTag = `integrated/${sourceBranch}`

  // check if target branch and source branch are the same
  if (targetBranch === sourceBranch) {
    logError(`Can't merge ${sourceBranch} in ${targetBranch}`)
    process.exit(1)
  }

  // check if source branch has been pushed
  try {
    const { stdout } = await exec(`git ls-remote ${origin} ${sourceBranch}`)
    if (!stdout) {
      throw new Error()
    }
  } catch(err) {
    logError(`${sourceBranch} has not been pushed yet`)
    process.exit(1)
  }

  const { stdout: refSourceBranch } = await exec(`git rev-parse ${sourceBranch}`)
  const { stdout: refSourceBranchRemote } = await exec(`git rev-parse ${sourceBranchRemote}`)
  const { stdout: refTargetBranch } = await exec(`git rev-parse ${targetBranch}`)
  const { stdout: refTargetBranchRemote } = await exec(`git rev-parse ${targetBranchRemote}`)
  const { stdout: refMerge } = await exec(`git merge-base ${targetBranch} ${sourceBranch}`)

  // check if target branch is uptodate
  if (refTargetBranch !== refTargetBranchRemote) {
    logError(`${targetBranch} ist not uptodate with ${targetBranchRemote}`)
    process.exit(1)
  }

  // check if source branch is uptodate
  if (refSourceBranch !== refSourceBranchRemote) {
    logError(`${sourceBranch} ist not uptodate with ${sourceBranchRemote}`)
    process.exit(1)
  }

  // check if source branch contains commits
  if (refSourceBranch === refTargetBranch) {
    logError(`${sourceBranch} does not seem to have any commits`)
    process.exit(1)
  }

  // check if the source branch is in line with the target branch
  if (refMerge != refTargetBranch) {
    logError(`${sourceBranch} is currently not in line`)
    process.exit(1)
  }

  // merge source branch into target branch with --no-ff
  logAction(`Merging ${sourceBranch} into ${targetBranch}...`)
  try {
    const { stdout, stderr } = await exec(`git merge "${sourceBranch}" --no-ff --no-edit`)
    process.stdout.write(stdout)
    process.stderr.write(stderr)
  } catch(err) {
    logError(`Error merging ${sourceBranch} into ${targetBranch}`)
    console.error(err)
    process.exit(1)
  }

  // new line separator
  console.log()

  // create integrated tag
  const { createTag } = await prompts({
    type: 'confirm',
    name: 'createTag',
    message: `Create integrated tag?`,
    initial: true,
    onState: onAbort
  })

  if (createTag) {
    logAction('Creating integrated tag...')
    try {
      const { stdout, stderr } = await exec(`git tag -a "${integratedTag}" -m "" "${sourceBranch}"`)
      process.stdout.write(stdout)
      process.stderr.write(stderr)
    } catch(err) {
      logError('Error creating integrated tag')
      console.error(err)
      process.exit(1)
    }

    logAction('Pushing integrated tag...')
    try {
      const { stdout, stderr } = await exec(`git push "${origin}" "${integratedTag}"`)
      process.stdout.write(stdout)
      process.stderr.write(stderr)
    } catch(err) {
      logError('Error pushing integrated tag')
      console.error(err)
      process.exit(1)
    }
  }

  // new line separator
  console.log()

  // delete source branch (local and remote)
  const { deleteBranch } = await prompts({
    type: 'confirm',
    name: 'deleteBranch',
    message: `Do you want to delete ${sourceBranch}?`,
    initial: true,
    onState: onAbort
  })

  if (deleteBranch) {
    logAction(`Deleting ${sourceBranch}...`)
    try {
      const { stdout, stderr } = await exec(`git branch -D "${sourceBranch}"`)
      process.stdout.write(stdout)
      process.stderr.write(stderr)
    } catch(err) {
      logError(`Error deleting ${sourceBranch}`)
      console.error(err)
      process.exit(1)
    }

    logAction(`Deleting ${sourceBranchRemote}...`)
    try {
      const { stdout, stderr } = await exec(`git push ${origin} :"${sourceBranch}"`)
      process.stdout.write(stdout)
      process.stderr.write(stderr)
    } catch(err) {
      logError(`Error deleting ${sourceBranchRemote}`)
      console.error(err)
      process.exit(1)
    }
  }

  // new line separator
  console.log()

  // push changes to target branch
  const { pushTargetBranch } = await prompts({
    type: 'confirm',
    name: 'pushTargetBranch',
    message: `Do you want to push ${targetBranch}?`,
    initial: true,
    onState: onAbort
  })

  if (pushTargetBranch) {
    logAction(`Pushing ${targetBranch}...`)
    try {
      const { stdout, stderr } = await exec(`git push ${origin} ${targetBranch}`)
      process.stdout.write(stdout)
      process.stderr.write(stderr)
    } catch(err) {
      logError(`Error pushing ${targetBranch}`)
      console.error(err)
      process.exit(1)
    }
  }

  logSuccess('All done \\(´▽`)/', true)
}

function logAction(text, newLine = false) {
  newLine && console.log()
  console.log(kleur.yellow(text))
}

function logSuccess(text, newLine = false) {
  newLine && console.log()
  console.log(kleur.green().bold(text))
}

function logError(text, newLine = false) {
  newLine && console.log()
  console.log(kleur.red().bold(text))
}

function onAbort(state) {
  if (state.aborted) {
    process.nextTick(() => {
      logSuccess('Ok bye \\_(-_-)_/', true)
      process.exit(0);
    })
  }
}

function onError (e) {
  if (e.stderr) {
    process.stderr.write(e.stderr)
  } else {
    console.error(e)
  }
}

run().catch(onError)

process.on('SIGINT', () => {
  onAbort({ aborted: true })
});
